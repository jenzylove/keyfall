use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PromiseResult};
use qday_core::{MemStore, ONE, ONE_NEAR};

const PARAMS_JSON: &str = include_str!("../../sim/params.json");
const T: u128 = ONE;
const N: u128 = ONE_NEAR;
const START: u64 = 1_800_000_000_000;

fn params() -> Params {
    serde_json::from_str(PARAMS_JSON).unwrap()
}

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, signer: &str, now_ms: u64, deposit: u128) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("qday.testnet"))
        .predecessor_account_id(acc(predecessor))
        .signer_account_id(acc(signer))
        .block_timestamp(now_ms * 1_000_000)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(100));
    testing_env!(b.build());
}

fn quantum(on: bool) {
    TEST_SIGNER_TAG.with(|t| t.set(if on { 2 } else { 0 }));
}

fn setup() -> Contract {
    quantum(true);
    ctx("qday.testnet", "qday.testnet", START, 0);
    Contract::new(params(), Some(U64(START)))
}

/// Simulate the callback that registers a vault after its account exists.
fn make_vault(c: &mut Contract, name: &str, now: u64) -> AccountId {
    let vault = acc(&format!("{name}.qday.testnet"));
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("qday.testnet"))
        .predecessor_account_id(acc("qday.testnet"))
        .signer_account_id(acc("payer.testnet"))
        .block_timestamp(now * 1_000_000);
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(vec![])]
    );
    assert!(c.on_vault_created(vault.clone(), acc("payer.testnet"), U128(N)));
    vault
}

fn buy_as(c: &mut Contract, who: &str, near: u128, now: u64) -> u128 {
    ctx(who, who, now, near);
    c.buy(None).0
}

#[test]
fn config_matches_sim_params() {
    let c = setup();
    assert_eq!(c.config(), &params());
    assert_eq!(c.ft_total_supply().0, 21_000_000 * T);
}

#[test]
fn buy_registers_and_mints() {
    let mut c = setup();
    let got = buy_as(&mut c, "alice.testnet", 2 * N, START + 1);
    assert!(got > 0);
    assert_eq!(c.ft_balance_of(acc("alice.testnet")).0, got);
    let h = c.holder(acc("alice.testnet")).unwrap();
    assert_eq!(h.kind, Kind::Exposed);
    assert_eq!(c.stats().near_reserve.0, 2 * N - STORAGE_COST.as_yoctonear());
}

#[test]
fn create_vault_queues_account_with_only_the_quantum_key() {
    let mut c = setup();
    ctx("alice.testnet", "alice.testnet", START + 1, VAULT_MIN_DEPOSIT.as_yoctonear());
    let v = c.create_vault("alice".into(), Base64VecU8(vec![7u8; 1952]));
    assert_eq!(v.as_str(), "alice.qday.testnet");
    // not registered until the account really exists
    assert!(c.holder(v.clone()).is_none());
    let receipts = near_sdk::test_utils::get_created_receipts();
    assert!(!receipts.is_empty());
}

#[test]
#[should_panic(expected = "E_BAD_KEY")]
fn create_vault_rejects_wrong_key_size() {
    let mut c = setup();
    ctx("alice.testnet", "alice.testnet", START + 1, VAULT_MIN_DEPOSIT.as_yoctonear());
    c.create_vault("alice".into(), Base64VecU8(vec![7u8; 32]));
}

#[test]
#[should_panic(expected = "E_NOT_VAULT")]
fn exposed_wallet_cannot_raid() {
    let mut c = setup();
    buy_as(&mut c, "alice.testnet", 2 * N, START + 1);
    let v = make_vault(&mut c, "bob", START + 2);
    ctx("alice.testnet", "alice.testnet", START + 3, 0);
    c.raid(v, U128(1_000 * T));
}

#[test]
#[should_panic(expected = "E_NOT_QUANTUM")]
fn vault_move_signed_with_classical_key_is_refused() {
    let mut c = setup();
    let v = make_vault(&mut c, "bob", START + 1);
    buy_as(&mut c, v.as_str(), 2 * N, START + 2);
    quantum(false);
    ctx(v.as_str(), v.as_str(), START + 3, 0);
    c.boss_raid();
}

#[test]
#[should_panic(expected = "E_RELAYED")]
fn relayed_vault_move_is_refused() {
    let mut c = setup();
    let v = make_vault(&mut c, "bob", START + 1);
    buy_as(&mut c, v.as_str(), 2 * N, START + 2);
    ctx(v.as_str(), "relayer.testnet", START + 3, 0);
    c.boss_raid();
}

#[test]
#[should_panic(expected = "E_NOT_QUANTUM")]
fn tokens_leave_a_vault_only_with_a_quantum_signature() {
    let mut c = setup();
    let v = make_vault(&mut c, "bob", START + 1);
    buy_as(&mut c, v.as_str(), 2 * N, START + 2);
    buy_as(&mut c, "alice.testnet", N, START + 3);
    quantum(false);
    ctx(v.as_str(), v.as_str(), START + 4, 1);
    c.ft_transfer(acc("alice.testnet"), U128(T), None);
}

#[test]
#[should_panic(expected = "E_FROZEN")]
fn exposed_balances_freeze_at_q_day() {
    let mut c = setup();
    buy_as(&mut c, "alice.testnet", N, START + 1);
    let v = make_vault(&mut c, "alice", START + 2);
    let qd = c.stats().q_day_ms.0;
    ctx("alice.testnet", "alice.testnet", qd, 1);
    c.ft_transfer(v, U128(T), None);
}

#[test]
fn migrate_raid_defend_shield_boss_harvest_finalize() {
    let mut c = setup();
    let p = params();
    let att = make_vault(&mut c, "att", START + 1);
    let def = make_vault(&mut c, "def", START + 1);
    buy_as(&mut c, att.as_str(), 3 * N, START + 2);
    buy_as(&mut c, "dave.testnet", 3 * N, START + 3);
    // migrate dave's exposed bag into his vault
    let bal = c.ft_balance_of(acc("dave.testnet")).0;
    ctx("dave.testnet", "dave.testnet", START + 4, 1);
    c.ft_transfer(def.clone(), U128(bal), None);
    assert_eq!(c.ft_balance_of(def.clone()).0, bal);
    assert_eq!(c.feed(Some(1))[0].kind, "migrate");

    // raid and defend
    ctx(att.as_str(), att.as_str(), START + 10, 0);
    let id = c.raid(def.clone(), U128(10_000 * T));
    ctx(def.as_str(), def.as_str(), START + 20, 0);
    let won = c.defend(id).0;
    assert_eq!(won, 10_000 * T - 10_000 * T * p.raid_burn_bps as u128 / 10_000);

    // shield and boss
    ctx(def.as_str(), def.as_str(), START + 30, 0);
    let s = c.charge_shield(U128(c.ft_balance_of(def.clone()).0 / 100 + 1));
    assert_eq!(s, 1_000);
    let gained = c.boss_raid().0;
    assert!(gained > 0);

    // harvest after the first epoch
    ctx("anyone.testnet", "anyone.testnet", START + p.epoch_ms, 0);
    assert!(c.stats().harvest_due);
    c.harvest();
    assert!(!c.stats().harvest_due);

    // finalize after Q-Day
    let qd = c.stats().q_day_ms.0;
    ctx("anyone.testnet", "anyone.testnet", qd, 0);
    let r = c.finalize();
    assert_eq!(r.vaults.0, 2);
    assert_eq!(r.top_vaults.len(), 2);
}

/// Golden test: the same script through the contract and through the core
/// rules on an in-memory store ends in exactly the same state.
#[test]
fn contract_equals_core_rules_golden() {
    let mut c = setup();
    let p = params();
    let mut s = State::genesis(&p, START);
    let mut m = MemStore::default();

    let a = make_vault(&mut c, "a", START + 1);
    let b = make_vault(&mut c, "b", START + 1);
    {
        let mut g = Game::new(&p, &mut s, &mut m);
        g.register(a.as_str(), Kind::Vault).unwrap();
        g.register(b.as_str(), Kind::Vault).unwrap();
    }
    let storage = STORAGE_COST.as_yoctonear();
    let script: Vec<(u64, &str)> = vec![
        (10, "buy a 5"), (11, "buy b 2"), (12, "buy e1 4"), (13, "buy e2 1"),
        (20, "raid a e1"), (700_000, "resolve 1"),
        (800_000, "raid b a"), (800_100, "defend a 2"),
        (900_000, "shield b"), (900_001, "boss a"), (900_002, "boss b"),
        (21_600_000, "harvest"), (21_600_100, "sell e2"), (21_600_200, "migrate e1 a"),
        (43_200_000, "harvest"), (43_300_000, "sell a"),
    ];
    for (dt, op) in script {
        let now = START + dt;
        let w: Vec<&str> = op.split(' ').collect();
        let id = |x: &str| -> String {
            match x { "a" => a.to_string(), "b" => b.to_string(), other => format!("{other}.testnet") }
        };
        let mut g = Game::new(&p, &mut s, &mut m);
        match w[0] {
            "buy" => {
                let who = id(w[1]);
                let near: u128 = w[2].parse::<u128>().unwrap() * N;
                let core_in = if g.is_registered(&who) { near } else {
                    g.register(&who, Kind::Exposed).unwrap();
                    near - storage
                };
                g.buy(&who, core_in, 0, now).unwrap();
                ctx(&who, &who, now, near);
                c.buy(None);
            }
            "raid" => {
                let (x, y) = (id(w[1]), id(w[2]));
                g.raid(&x, &y, 20_000 * T, now).unwrap();
                ctx(&x, &x, now, 0);
                c.raid(acc(&y), U128(20_000 * T));
            }
            "defend" => {
                let x = id(w[1]);
                let rid: u64 = w[2].parse().unwrap();
                g.defend(&x, rid, now).unwrap();
                ctx(&x, &x, now, 0);
                c.defend(U64(rid));
            }
            "resolve" => {
                let rid: u64 = w[1].parse().unwrap();
                g.resolve(rid, now).unwrap();
                ctx("x.testnet", "x.testnet", now, 0);
                c.resolve(U64(rid));
            }
            "shield" => {
                let x = id(w[1]);
                let amt = g.balance_of(&x) / 25;
                g.charge_shield(&x, amt, now).unwrap();
                ctx(&x, &x, now, 0);
                c.charge_shield(U128(amt));
            }
            "boss" => {
                let x = id(w[1]);
                g.boss_raid(&x, now).unwrap();
                ctx(&x, &x, now, 0);
                c.boss_raid();
            }
            "harvest" => {
                g.harvest(now).unwrap();
                ctx("x.testnet", "x.testnet", now, 0);
                c.harvest();
            }
            "sell" => {
                let x = id(w[1]);
                let amt = g.balance_of(&x) / 2;
                g.sell(&x, amt, 0, now).unwrap();
                ctx(&x, &x, now, 0);
                c.sell(U128(amt), None);
            }
            "migrate" => {
                let (x, y) = (id(w[1]), id(w[2]));
                let amt = g.balance_of(&x);
                g.transfer(&x, &y, amt, now).unwrap();
                ctx(&x, &x, now, 1);
                c.ft_transfer(acc(&y), U128(amt), None);
            }
            _ => unreachable!(),
        }
        assert_eq!(c.state, s, "state differs after `{op}`");
        for who in [a.to_string(), b.to_string(), "e1.testnet".into(), "e2.testnet".into()] {
            assert_eq!(c.ft_balance_of(acc(&who)).0, Game::new(&p, &mut s, &mut m).balance_of(&who), "{who} after `{op}`");
        }
        assert!(c.state.balanced(&p));
    }
}
