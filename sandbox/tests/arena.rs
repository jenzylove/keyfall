//! KEYFALL on a real local NEAR node (near-workspaces sandbox).
//!
//! These deploy the same wasm CI builds and play the game with real signed
//! transactions: ed25519 for exposed wallets, ML-DSA-65 for vaults. Nothing is
//! mocked; the quantum check runs inside the NEAR runtime.
//!
//! Wasm: `KEYFALL_WASM` or `../target/near/qday_contract/qday_contract.wasm`
//! (build it with `cargo near build non-reproducible-wasm --no-abi` in `contract/`).

#![allow(unused_must_use)] // `ok()` already asserted success; some results are not needed

use base64::Engine;
use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{AccessKey, Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};
use std::time::Duration;

const ONE: u128 = 1_000_000_000_000_000_000; // one coin, 18 decimals

fn wasm() -> Vec<u8> {
    let path = std::env::var("KEYFALL_WASM").unwrap_or_else(|_| "../target/near/qday_contract/qday_contract.wasm".into());
    std::fs::read(&path).unwrap_or_else(|e| panic!("read {path}: {e}. Build the contract first."))
}

/// The real rule set from sim/params.json with a short clock for the sandbox.
fn params(epoch_ms: u64, season_epochs: u64, defend_window_ms: u64) -> Value {
    let mut p: Value = serde_json::from_str(include_str!("../../sim/params.json")).unwrap();
    p["epoch_ms"] = json!(epoch_ms);
    p["season_epochs"] = json!(season_epochs);
    p["defend_window_ms"] = json!(defend_window_ms);
    p["immunity_ms"] = json!(1_000);
    p
}

async fn deploy(worker: &Worker<Sandbox>, p: Value) -> anyhow::Result<Contract> {
    let c = worker.dev_deploy(&wasm()).await?;
    c.call("new").args_json(json!({ "params": p })).max_gas().transact().await?.into_result()?;
    Ok(c)
}

fn ok(r: ExecutionFinalResult, what: &str) -> ExecutionFinalResult {
    assert!(r.is_success(), "{what} failed: {:?}", r.failures());
    r
}

fn refused(r: ExecutionFinalResult, code: &str, what: &str) {
    assert!(!r.is_success(), "{what} should have been refused with {code}");
    let msg = format!("{:?}", r.into_result().unwrap_err());
    assert!(msg.contains(code), "{what}: expected {code}, got {msg}");
    println!("  refused as expected: {what} -> {code}");
}

async fn view(worker: &Worker<Sandbox>, c: &AccountId, m: &str, args: Value) -> anyhow::Result<Value> {
    Ok(worker.view(c, m).args_json(args).await?.json::<Value>()?)
}

async fn balance(worker: &Worker<Sandbox>, c: &AccountId, who: &AccountId) -> anyhow::Result<u128> {
    let v = view(worker, c, "ft_balance_of", json!({ "account_id": who })).await?;
    Ok(v.as_str().unwrap().parse()?)
}

async fn buy(who: &Account, c: &AccountId, near: u128) -> anyhow::Result<u128> {
    let r = ok(who.call(c, "buy").args_json(json!({})).deposit(NearToken::from_near(near)).gas(Gas::from_tgas(50)).transact().await?, "buy");
    Ok(r.json::<String>()?.parse()?)
}

/// `payer` creates `<name>.<contract>` born with one ML-DSA-65 key. Returns the
/// vault as an account that signs with that key.
async fn create_vault(worker: &Worker<Sandbox>, payer: &Account, c: &AccountId, name: &str) -> anyhow::Result<Account> {
    let sk = SecretKey::from_random(KeyType::MLDSA65);
    let raw = sk.public_key().key_data().to_vec();
    assert_eq!(raw.len(), 1952, "raw ML-DSA-65 public key");
    let pk64 = base64::engine::general_purpose::STANDARD.encode(&raw);
    ok(
        payer
            .call(c, "create_vault")
            .args_json(json!({ "name": name, "pq_public_key": pk64 }))
            .deposit(NearToken::from_millinear(500))
            .gas(Gas::from_tgas(100))
            .transact()
            .await?,
        "create_vault",
    );
    let id: AccountId = format!("{name}.{c}").parse()?;
    Ok(Account::from_secret_key(id, sk, worker))
}

/// The raw access key list from the node (workspaces cannot list hash-only keys).
async fn key_list(worker: &Worker<Sandbox>, id: &AccountId) -> anyhow::Result<Vec<Value>> {
    let body = json!({ "jsonrpc": "2.0", "id": "k", "method": "query",
        "params": { "request_type": "view_access_key_list", "finality": "final", "account_id": id } });
    let r: Value = reqwest::Client::new().post(worker.rpc_addr()).json(&body).send().await?.json().await?;
    Ok(r["result"]["keys"].as_array().cloned().unwrap_or_default())
}

async fn holder(worker: &Worker<Sandbox>, c: &AccountId, who: &AccountId) -> anyhow::Result<Value> {
    view(worker, c, "holder", json!({ "account_id": who })).await
}

#[tokio::test]
async fn arena_moves_on_a_real_node() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    // Long epochs (nothing expires by accident), a 6 second defend window.
    let game = deploy(&worker, params(3_600_000, 100, 6_000)).await?;
    let c = game.id().clone();
    let (alice, bob, carol) = (worker.dev_create_tla().await?, worker.dev_create_tla().await?, worker.dev_create_tla().await?);

    println!("buy: three exposed wallets buy from the curve");
    let a_bought = buy(&alice, &c, 3).await?;
    buy(&bob, &c, 3).await?;
    buy(&carol, &c, 2).await?;
    assert!(a_bought > 0);
    assert_eq!(balance(&worker, &c, alice.id()).await?, a_bought);
    assert_eq!(holder(&worker, &c, alice.id()).await?["kind"], "exposed");

    println!("create_vault: born with exactly one ML-DSA-65 key");
    let av = create_vault(&worker, &alice, &c, "alice").await?;
    let bv = create_vault(&worker, &bob, &c, "bob").await?;
    assert_eq!(holder(&worker, &c, av.id()).await?["kind"], "vault");
    let keys = key_list(&worker, av.id()).await?;
    println!("  {} keys: {}", av.id(), serde_json::to_string(&keys)?);
    assert_eq!(keys.len(), 1, "a vault is born with one key");
    let k = keys[0]["public_key"].as_str().unwrap_or("");
    assert!(!k.starts_with("ed25519:") && !k.starts_with("secp256k1:"), "the only key is post quantum, got {k}");
    assert_eq!(keys[0]["access_key"]["permission"], "FullAccess");

    println!("migrate: each exposed bag moves into its vault");
    for (w, v) in [(&alice, &av), (&bob, &bv)] {
        let amt = balance(&worker, &c, w.id()).await?;
        ok(
            w.call(&c, "ft_transfer")
                .args_json(json!({ "receiver_id": v.id(), "amount": amt.to_string() }))
                .deposit(NearToken::from_yoctonear(1))
                .gas(Gas::from_tgas(50))
                .transact()
                .await?,
            "migrate",
        );
        assert_eq!(balance(&worker, &c, w.id()).await?, 0);
        assert_eq!(balance(&worker, &c, v.id()).await?, amt);
    }

    println!("shield: the vault burns coins for a shield, signed with ML-DSA-65");
    let r = ok(av.call(&c, "charge_shield").args_json(json!({ "amount": (1_000 * ONE).to_string() })).gas(Gas::from_tgas(50)).transact().await?, "shield");
    let bps: u32 = r.json()?;
    assert!(bps > 0);
    assert_eq!(holder(&worker, &c, av.id()).await?["shield_bps"], bps);

    println!("raid and resolve: alice's vault raids carol's exposed wallet, anyone settles");
    let carol_before = balance(&worker, &c, carol.id()).await?;
    let av_before = balance(&worker, &c, av.id()).await?;
    let stake = 5_000 * ONE;
    let r = ok(av.call(&c, "raid").args_json(json!({ "target": carol.id(), "stake": stake.to_string() })).gas(Gas::from_tgas(60)).transact().await?, "raid");
    let raid_id: String = r.json()?;
    let early = carol.call(&c, "resolve").args_json(json!({ "raid_id": raid_id })).gas(Gas::from_tgas(60)).transact().await?;
    refused(early, "E_WINDOW_OPEN", "resolve inside the defend window");
    tokio::time::sleep(Duration::from_millis(7_000)).await;
    let r = ok(carol.call(&c, "resolve").args_json(json!({ "raid_id": raid_id })).gas(Gas::from_tgas(60)).transact().await?, "resolve");
    let take: u128 = r.json::<String>()?.parse()?;
    assert!(take > 0, "an undefended raid on an exposed wallet takes coins");
    assert_eq!(balance(&worker, &c, carol.id()).await?, carol_before - take);
    assert!(balance(&worker, &c, av.id()).await? > av_before, "the attacker gets stake back plus the take");
    assert_eq!(view(&worker, &c, "get_raid", json!({ "raid_id": raid_id })).await?["status"], "resolved");

    println!("defend: bob's vault raids alice's vault, alice defends in the window");
    let av_before = balance(&worker, &c, av.id()).await?;
    let r = ok(bv.call(&c, "raid").args_json(json!({ "target": av.id(), "stake": stake.to_string() })).gas(Gas::from_tgas(60)).transact().await?, "vault raid");
    let raid_id: String = r.json()?;
    let r = ok(av.call(&c, "defend").args_json(json!({ "raid_id": raid_id })).gas(Gas::from_tgas(60)).transact().await?, "defend");
    let won: u128 = r.json::<String>()?.parse()?;
    assert!(won > 0 && won < stake, "the defender wins the stake minus the burn");
    assert_eq!(balance(&worker, &c, av.id()).await?, av_before + won);
    assert_eq!(view(&worker, &c, "get_raid", json!({ "raid_id": raid_id })).await?["status"], "defended");

    println!("boss: bob's vault hits Satoshi once per epoch");
    let sat_before: u128 = view(&worker, &c, "stats", json!({})).await?["satoshi_tokens"].as_str().unwrap().parse()?;
    let r = ok(bv.call(&c, "boss_raid").args_json(json!({})).gas(Gas::from_tgas(50)).transact().await?, "boss");
    let gained: u128 = r.json::<String>()?.parse()?;
    assert!(gained > 0);
    let sat_after: u128 = view(&worker, &c, "stats", json!({})).await?["satoshi_tokens"].as_str().unwrap().parse()?;
    assert!(sat_after < sat_before);
    refused(bv.call(&c, "boss_raid").args_json(json!({})).gas(Gas::from_tgas(50)).transact().await?, "E_BOSS_DONE", "second boss hit in one epoch");

    println!("quantum check: an ed25519 key on a vault cannot move its coins");
    // The vault (signing with ML-DSA-65) adds a classical key to itself...
    let ed = SecretKey::from_random(KeyType::ED25519);
    ok(av.batch(av.id()).add_key(ed.public_key(), AccessKey::full_access()).transact().await?, "add ed25519 key");
    let classical = Account::from_secret_key(av.id().clone(), ed, &worker);
    // ...and every vault move signed with it is refused by the contract.
    refused(
        classical.call(&c, "raid").args_json(json!({ "target": carol.id(), "stake": (1_000 * ONE).to_string() })).gas(Gas::from_tgas(60)).transact().await?,
        "E_NOT_QUANTUM",
        "raid signed with ed25519",
    );
    refused(
        classical
            .call(&c, "ft_transfer")
            .args_json(json!({ "receiver_id": carol.id(), "amount": ONE.to_string() }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(50))
            .transact()
            .await?,
        "E_NOT_QUANTUM",
        "vault transfer signed with ed25519",
    );
    refused(
        classical.call(&c, "sell").args_json(json!({ "amount": ONE.to_string() })).gas(Gas::from_tgas(60)).transact().await?,
        "E_NOT_QUANTUM",
        "vault sell signed with ed25519",
    );
    refused(classical.call(&c, "charge_shield").args_json(json!({ "amount": ONE.to_string() })).gas(Gas::from_tgas(50)).transact().await?, "E_NOT_QUANTUM", "shield signed with ed25519");

    println!("sell: the same move signed with ML-DSA-65 goes through and pays NEAR to the vault");
    let near_before = av.view_account().await?.balance;
    let r = ok(av.call(&c, "sell").args_json(json!({ "amount": (10_000 * ONE).to_string() })).gas(Gas::from_tgas(60)).transact().await?, "vault sell");
    let paid: u128 = r.json::<String>()?.parse()?;
    assert!(paid > 0);
    tokio::time::sleep(Duration::from_millis(2_000)).await; // the NEAR transfer is its own receipt
    assert!(av.view_account().await?.balance > near_before);
    println!("arena moves: all passed");
    Ok(())
}

#[tokio::test]
async fn q_day_freezes_exposed_and_finalizes() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    // A short season: 9 epochs of 5 seconds, Q-Day 45 seconds after deploy.
    let game = deploy(&worker, params(5_000, 9, 3_000)).await?;
    let c = game.id().clone();
    let (dave, erin) = (worker.dev_create_tla().await?, worker.dev_create_tla().await?);
    buy(&dave, &c, 2).await?;
    buy(&erin, &c, 2).await?;
    let ev = create_vault(&worker, &erin, &c, "erin").await?;
    let amt = balance(&worker, &c, erin.id()).await?;
    ok(
        erin.call(&c, "ft_transfer")
            .args_json(json!({ "receiver_id": ev.id(), "amount": amt.to_string() }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(50))
            .transact()
            .await?,
        "migrate",
    );
    refused(dave.call(&c, "finalize").args_json(json!({})).max_gas().transact().await?, "E_SEASON_RUNNING", "finalize before Q-Day");

    println!("waiting for Q-Day");
    for _ in 0..120 {
        if view(&worker, &c, "stats", json!({})).await?["after_q_day"] == true {
            break;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    assert_eq!(view(&worker, &c, "stats", json!({})).await?["after_q_day"], true, "Q-Day arrived");

    println!("freeze: exposed coins cannot move or sell; vault raids are over");
    let dave_bal = balance(&worker, &c, dave.id()).await?;
    assert!(dave_bal > 0);
    refused(
        dave.call(&c, "ft_transfer")
            .args_json(json!({ "receiver_id": ev.id(), "amount": dave_bal.to_string() }))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(50))
            .transact()
            .await?,
        "E_FROZEN",
        "exposed transfer after Q-Day",
    );
    refused(dave.call(&c, "sell").args_json(json!({ "amount": ONE.to_string() })).gas(Gas::from_tgas(60)).transact().await?, "E_FROZEN", "exposed sell after Q-Day");
    refused(
        ev.call(&c, "raid").args_json(json!({ "target": dave.id(), "stake": (1_000 * ONE).to_string() })).gas(Gas::from_tgas(60)).transact().await?,
        "E_QDAY_PASSED",
        "raid after Q-Day",
    );
    // A vault keeps its coins and can still cash them out.
    ok(ev.call(&c, "sell").args_json(json!({ "amount": (1_000 * ONE).to_string() })).gas(Gas::from_tgas(60)).transact().await?, "vault sell after Q-Day");

    println!("finalize: the season result is written once, by anyone");
    let r = ok(dave.call(&c, "finalize").args_json(json!({})).max_gas().transact().await?, "finalize");
    let season: Value = r.json()?;
    println!("  season: {season}");
    assert_eq!(season["vaults"], "1");
    assert_eq!(season["top_vaults"][0][0], ev.id().to_string());
    assert!(season["frozen_exposed"].as_str().unwrap().parse::<u128>()? > 0);
    assert_eq!(view(&worker, &c, "season", json!({})).await?, season);
    refused(erin.call(&c, "finalize").args_json(json!({})).max_gas().transact().await?, "E_FINALIZED", "second finalize");
    println!("q-day: all passed");
    Ok(())
}

/// Season 5 arcade rules (sim/params-arcade5.json) with a sandbox clock:
/// a 2 bullet clip that regenerates every 6 s, one shield charge, a 3 s
/// cooldown on Satoshi and a boss that dies in three hits.
fn arcade_params() -> Value {
    let mut p: Value = serde_json::from_str(include_str!("../../sim/params-arcade5.json")).unwrap();
    p["defend_window_ms"] = json!(10_000);
    p["immunity_ms"] = json!(1_000);
    p["boss_bps"] = json!(3_400);
    let a = &mut p["arcade"];
    a["clip_size"] = json!(2);
    a["bullet_regen_ms"] = json!(6_000);
    a["shield_max"] = json!(1);
    a["shield_regen_ms"] = json!(3_600_000);
    a["boss_cooldown_ms"] = json!(3_000);
    a["round_max_ms"] = json!(3_600_000);
    p
}

/// A number from a view, whether it comes as a JSON number or a string.
fn num(v: &Value) -> u128 {
    v.as_u64().map(u128::from).or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or_else(|| panic!("number, got {v}"))
}
fn arc(h: &Value, k: &str) -> u128 {
    num(&h["arcade"][k])
}

#[tokio::test]
async fn arcade_bullets_shields_and_satoshi_blast() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let p = arcade_params();
    let reload_price = num(&p["arcade"]["reload_price"]);
    let game = deploy(&worker, p).await?;
    let c = game.id().clone();
    let g60 = Gas::from_tgas(60);
    let (alice, bob, dan, carol) = (worker.dev_create_tla().await?, worker.dev_create_tla().await?, worker.dev_create_tla().await?, worker.dev_create_tla().await?);
    for w in [&alice, &bob, &dan, &carol] {
        buy(w, &c, 3).await?;
    }
    let av = create_vault(&worker, &alice, &c, "alice").await?;
    let bv = create_vault(&worker, &bob, &c, "bob").await?;
    let dv = create_vault(&worker, &dan, &c, "dan").await?;
    for (w, v) in [(&alice, &av), (&bob, &bv), (&dan, &dv)] {
        let amt = balance(&worker, &c, w.id()).await?;
        ok(
            w.call(&c, "ft_transfer")
                .args_json(json!({ "receiver_id": v.id(), "amount": amt.to_string() }))
                .deposit(NearToken::from_yoctonear(1))
                .gas(Gas::from_tgas(50))
                .transact()
                .await?,
            "migrate",
        );
    }
    let h = holder(&worker, &c, av.id()).await?;
    assert_eq!((arc(&h, "bullets"), arc(&h, "shields")), (2, 1), "a vault starts with a full clip and full shields");
    let stake = (5_000 * ONE).to_string();
    let raid = |a: &Account, t: &AccountId| a.call(&c, "raid").args_json(json!({ "target": t, "stake": stake })).gas(g60);

    println!("a raid is a shot: it costs one bullet");
    ok(raid(&av, carol.id()).transact().await?, "raid carol");
    assert_eq!(arc(&holder(&worker, &c, av.id()).await?, "bullets"), 1);

    println!("block spends a shield charge, not a bullet");
    let id: String = ok(raid(&bv, av.id()).transact().await?, "bob raids alice").json()?;
    ok(av.call(&c, "block").args_json(json!({ "raid_id": id })).gas(g60).transact().await?, "block");
    let h = holder(&worker, &c, av.id()).await?;
    assert_eq!((arc(&h, "bullets"), arc(&h, "shields")), (1, 0));
    assert_eq!(view(&worker, &c, "get_raid", json!({ "raid_id": id })).await?["status"], "blocked");

    println!("no charges left: block is refused; defend spends a bullet");
    tokio::time::sleep(Duration::from_millis(1_500)).await; // immunity after the block
    let id: String = ok(raid(&dv, av.id()).transact().await?, "dan raids alice").json()?;
    refused(av.call(&c, "block").args_json(json!({ "raid_id": id })).gas(g60).transact().await?, "E_NO_SHIELDS", "block with no charges");
    ok(av.call(&c, "defend").args_json(json!({ "raid_id": id })).gas(g60).transact().await?, "defend");
    let h = holder(&worker, &c, av.id()).await?;
    assert_eq!((arc(&h, "bullets"), arc(&h, "shields")), (0, 0));
    assert_eq!(view(&worker, &c, "get_raid", json!({ "raid_id": id })).await?["status"], "defended");

    println!("empty clip: E_NO_BULLETS, then a free bullet regenerates");
    refused(raid(&av, bv.id()).transact().await?, "E_NO_BULLETS", "raid with an empty clip");
    assert!(arc(&h, "next_bullet_ms") > 0, "the view says when the next bullet comes");
    let mut back = false;
    for _ in 0..30 {
        if arc(&holder(&worker, &c, av.id()).await?, "bullets") >= 1 {
            back = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(1_000)).await;
    }
    assert!(back, "a bullet came back within 30 s");

    println!("reload burns the reload price and fills the clip");
    let before = balance(&worker, &c, av.id()).await?;
    let burned: u128 = ok(av.call(&c, "reload").args_json(json!({})).gas(g60).transact().await?, "reload").json::<String>()?.parse()?;
    assert_eq!(burned, reload_price);
    assert_eq!(burned, 50_000 * ONE, "reload costs 50k");
    assert_eq!(balance(&worker, &c, av.id()).await?, before - burned);
    assert_eq!(arc(&holder(&worker, &c, av.id()).await?, "bullets"), 2);

    println!("break: on and off");
    ok(av.call(&c, "set_break").args_json(json!({ "on": true })).gas(g60).transact().await?, "break on");
    assert_eq!(holder(&worker, &c, av.id()).await?["arcade"]["on_break"], true);
    ok(av.call(&c, "set_break").args_json(json!({ "on": false })).gas(g60).transact().await?, "break off");
    assert_eq!(holder(&worker, &c, av.id()).await?["arcade"]["on_break"], false);

    println!("Satoshi: a hit is damage only, then a cooldown");
    let a0 = view(&worker, &c, "arena", json!({})).await?;
    let spawn = num(&a0["boss_spawn"]);
    assert_eq!(num(&a0["boss_hp"]), spawn);
    let before = balance(&worker, &c, av.id()).await?;
    ok(av.call(&c, "boss_raid").args_json(json!({})).gas(g60).transact().await?, "alice hits Satoshi");
    assert_eq!(balance(&worker, &c, av.id()).await?, before, "a hit moves no coins");
    assert!(num(&view(&worker, &c, "arena", json!({})).await?["boss_hp"]) < spawn);
    refused(av.call(&c, "boss_raid").args_json(json!({})).gas(g60).transact().await?, "E_BOSS_COOLDOWN", "second hit inside the cooldown");
    ok(bv.call(&c, "boss_raid").args_json(json!({})).gas(g60).transact().await?, "bob hits Satoshi");
    ok(dv.call(&c, "boss_raid").args_json(json!({})).gas(g60).transact().await?, "the third hit kills him");

    println!("blast: the pot is split by damage, credited lazily, claimed once");
    let a1 = view(&worker, &c, "arena", json!({})).await?;
    let last = a1["last_round"].clone();
    println!("  last round: {last}");
    assert!(last["killer"].is_string(), "the round ended in a blast");
    assert!(last["winner"].is_string(), "a blast round has a winner");
    let b = view(&worker, &c, "blast", json!({ "round": num(&last["round"]).to_string() })).await?;
    let (pot, dmg) = (num(&b["pot"]), num(&b["damage"]));
    assert!(pot > 0);
    assert_eq!(num(&b["hitters"]), 3);
    let pend = |h: &Value| num(&h["arcade"]["blast_pending"]);
    let (ha, hb, hd) = (holder(&worker, &c, av.id()).await?, holder(&worker, &c, bv.id()).await?, holder(&worker, &c, dv.id()).await?);
    let (pa, pb, pd) = (pend(&ha), pend(&hb), pend(&hd));
    println!("  pot {pot}, damage {dmg}, shares {pa} {pb} {pd}");
    assert_eq!(pa, pb, "equal damage, equal share");
    assert!(pd > 0 && pd <= pa, "the killing hit was capped by his life left");
    assert!(pa + pb + pd <= pot && pot - (pa + pb + pd) < 10, "shares add up to the pot");
    let hit = spawn * 3_400 / 10_000;
    assert_eq!(pa, (pot / ONE) * (hit / ONE) / (dmg / ONE) * ONE, "share = pot x damage / total damage");
    assert_eq!(balance(&worker, &c, av.id()).await?, num(&ha["balance"]), "pending coins already count in the balance");
    // anyone can claim for bob, once
    let got: u128 = ok(carol.call(&c, "claim_blast").args_json(json!({ "account_id": bv.id() })).gas(g60).transact().await?, "claim for bob").json::<String>()?.parse()?;
    assert_eq!(got, pb);
    assert_eq!(pend(&holder(&worker, &c, bv.id()).await?), 0);
    refused(carol.call(&c, "claim_blast").args_json(json!({ "account_id": bv.id() })).gas(g60).transact().await?, "E_NOTHING_TO_CLAIM", "second claim");
    // alice's share lands on her next move
    let bal = balance(&worker, &c, av.id()).await?;
    ok(av.call(&c, "set_break").args_json(json!({ "on": true })).gas(g60).transact().await?, "any move");
    assert_eq!(pend(&holder(&worker, &c, av.id()).await?), 0);
    assert_eq!(balance(&worker, &c, av.id()).await?, bal, "the claim moved pending coins into the bag, nothing more");
    assert!(num(&view(&worker, &c, "arena", json!({})).await?["boss_hp"]) > 0, "Satoshi respawned");

    println!("quantum check: arcade moves signed with ed25519 are refused");
    let ed = SecretKey::from_random(KeyType::ED25519);
    ok(av.batch(av.id()).add_key(ed.public_key(), AccessKey::full_access()).transact().await?, "add ed25519 key");
    let classical = Account::from_secret_key(av.id().clone(), ed, &worker);
    refused(classical.call(&c, "reload").args_json(json!({})).gas(g60).transact().await?, "E_NOT_QUANTUM", "reload signed with ed25519");
    refused(classical.call(&c, "buy_shield").args_json(json!({})).gas(g60).transact().await?, "E_NOT_QUANTUM", "buy_shield signed with ed25519");
    refused(classical.call(&c, "boss_raid").args_json(json!({})).gas(g60).transact().await?, "E_NOT_QUANTUM", "boss hit signed with ed25519");
    refused(classical.call(&c, "set_break").args_json(json!({ "on": false })).gas(g60).transact().await?, "E_NOT_QUANTUM", "break signed with ed25519");
    println!("arcade: all passed");
    Ok(())
}
