//! Q-DAY: a memecoin you play.
//!
//! NEP-141 token + NEP-145 storage + the game. Every rule lives in
//! `qday-core`, shared with the simulation; this contract adds accounts,
//! money, the quantum-signer check and events.
//!
//! Vault moves (raid, defend, shield, boss, transfers and sells out of a
//! vault) must be signed directly by the vault with an ML-DSA-65 key. The
//! runtime passes the borsh-encoded signer public key to every call; its
//! first byte is the key type (2 = ML-DSA-65).

use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, PromiseOrValue};
use qday_core::{
    quote_buy as core_quote_buy, quote_sell as core_quote_sell, regen, regen_next, spot_price, Blast, Error, Game, Holder, Kind, Params, Raid,
    RoundEnd, State, Store, DECIMALS,
};
use serde_json::json;

const ML_DSA_65_TAG: u8 = 2;
const ML_DSA_65_PUBKEY_LEN: usize = 1952;
/// NEP-145 registration cost for one holder record.
const STORAGE_COST: NearToken = NearToken::from_micronear(2_500);
/// Smallest deposit to create a vault (funds its gas; ML-DSA-65 transactions
/// are large).
const VAULT_MIN_DEPOSIT: NearToken = NearToken::from_millinear(200);
const FEED_SIZE: u64 = 64;
const GAS_FOR_VAULT_CALLBACK: Gas = Gas::from_tgas(15);
const GAS_FOR_RESOLVE_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_FOR_FT_ON_TRANSFER: Gas = Gas::from_tgas(35);

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct FeedItem {
    pub n: U64,
    pub at: U64,
    pub kind: String,
    pub actor: String,
    pub target: Option<String>,
    pub amount: U128,
    pub extra: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct SeasonResult {
    pub finalized_at: U64,
    pub frozen_exposed: U128,
    pub satoshi_frozen: U128,
    pub vault_total: U128,
    pub vaults: U64,
    pub burned: U128,
    pub top_vaults: Vec<(AccountId, U128)>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    params: Params,
    state: State,
    holders: LookupMap<String, Holder>,
    raids: LookupMap<u64, Raid>,
    vault_list: near_sdk::store::Vector<AccountId>,
    /// Every registered holder, exposed or vault, in order of arrival.
    holder_list: near_sdk::store::Vector<AccountId>,
    feed: LookupMap<u64, FeedItem>,
    feed_count: u64,
    season: Option<SeasonResult>,
    /// Arcade: Satoshi blast pots by round, and every finished round.
    blasts: LookupMap<u64, Blast>,
    rounds: LookupMap<u64, RoundEnd>,
    last_round: Option<RoundEnd>,
}

/// Adapter so the core rules can read and write chain storage.
struct ChainStore<'a> {
    holders: &'a mut LookupMap<String, Holder>,
    raids: &'a mut LookupMap<u64, Raid>,
    blasts: &'a mut LookupMap<u64, Blast>,
}

impl<'a> Store for ChainStore<'a> {
    fn holder(&self, id: &str) -> Option<Holder> {
        self.holders.get(id).cloned()
    }
    fn put_holder(&mut self, id: &str, h: Holder) {
        self.holders.insert(id.to_string(), h);
    }
    fn raid(&self, id: u64) -> Option<Raid> {
        self.raids.get(&id).cloned()
    }
    fn put_raid(&mut self, r: Raid) {
        self.raids.insert(r.id, r);
    }
    fn blast(&self, round: u64) -> Option<Blast> {
        self.blasts.get(&round).cloned()
    }
    fn put_blast(&mut self, b: Blast) {
        self.blasts.insert(b.round, b);
    }
}

/// Read only store for views (writes are ignored).
struct ViewStore<'a> {
    holders: &'a LookupMap<String, Holder>,
    raids: &'a LookupMap<u64, Raid>,
    blasts: &'a LookupMap<u64, Blast>,
}

impl<'a> Store for ViewStore<'a> {
    fn holder(&self, id: &str) -> Option<Holder> {
        self.holders.get(id).cloned()
    }
    fn put_holder(&mut self, _: &str, _: Holder) {}
    fn raid(&self, id: u64) -> Option<Raid> {
        self.raids.get(&id).cloned()
    }
    fn put_raid(&mut self, _: Raid) {}
    fn blast(&self, round: u64) -> Option<Blast> {
        self.blasts.get(&round).cloned()
    }
    fn put_blast(&mut self, _: Blast) {}
}

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

fn fail(e: Error) -> ! {
    env::panic_str(e.code())
}

/// Key type of the transaction signer: 0 ed25519, 1 secp256k1, 2 ML-DSA-65.
#[cfg(not(test))]
fn signer_key_tag() -> u8 {
    unsafe {
        near_sys::signer_account_pk(0);
        let len = near_sys::register_len(0);
        let mut buf = vec![0u8; len as usize];
        near_sys::read_register(0, buf.as_mut_ptr() as u64);
        buf.first().copied().unwrap_or(255)
    }
}

#[cfg(test)]
thread_local! {
    pub static TEST_SIGNER_TAG: std::cell::Cell<u8> = const { std::cell::Cell::new(2) };
}
#[cfg(test)]
fn signer_key_tag() -> u8 {
    TEST_SIGNER_TAG.with(|t| t.get())
}

fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "qday", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

fn emit_ft(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "nep141", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

#[near(serializers = [json])]
pub struct Stats {
    pub now_ms: U64,
    pub epoch: U64,
    pub epoch_ends_ms: U64,
    pub q_day_ms: U64,
    pub after_q_day: bool,
    pub harvest_due: bool,
    pub harvested: U64,
    pub exposed_tokens: U128,
    pub vault_tokens: U128,
    pub satoshi_tokens: U128,
    pub market_tokens: U128,
    pub escrow: U128,
    pub burned: U128,
    pub circulating: U128,
    pub near_reserve: U128,
    pub price_yocto_per_token: U128,
    pub vaults: U64,
    pub exposed_holders: U64,
    pub raids: U64,
    pub vault_share_bps: u32,
}

#[near(serializers = [json])]
pub struct HolderView {
    pub account: AccountId,
    pub kind: Kind,
    pub balance: U128,
    pub shield_bps: u32,
    pub immune_until: U64,
    pub under_raid: Option<U64>,
    pub raids_left: u32,
    pub boss_ready: bool,
    /// Arcade only (absent on older seasons).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arcade: Option<ArcadeView>,
}

#[near(serializers = [json])]
pub struct ArcadeView {
    pub bullets: u32,
    /// When the next free bullet arrives (0 = clip full).
    pub next_bullet_ms: U64,
    pub shields: u32,
    pub next_shield_ms: U64,
    /// When this vault may hit Satoshi again (0 = now).
    pub boss_next_ms: U64,
    pub on_break: bool,
    pub break_since: U64,
    /// Blast coins earned and not claimed yet (already counted in `balance`).
    pub blast_pending: U128,
    pub blast_round: Option<U64>,
    /// Damage dealt to Satoshi this round.
    pub damage: U128,
    /// Coins won and lost in the current round and the one before
    /// (pending blast coins included in the won column).
    pub round: U64,
    pub round_gain: U128,
    pub round_loss: U128,
    pub prev_gain: U128,
    pub prev_loss: U128,
}

#[near(serializers = [json])]
pub struct ArenaView {
    pub now_ms: U64,
    pub round: U64,
    pub round_started_ms: U64,
    /// The round ends here at the latest (if Satoshi survives).
    pub round_ends_ms: U64,
    /// Satoshi's life left this round, and at his last spawn.
    pub boss_hp: U128,
    pub boss_spawn: U128,
    pub boss_stash: U128,
    pub damage: U128,
    pub hitters: U64,
    pub reserve: U128,
    pub kills: U64,
    pub round_burned: U128,
    pub blast_escrow: U128,
    pub last_round: Option<RoundEnd>,
}

#[near]
impl Contract {
    /// Initialise once. Deployed together with the removal of every access
    /// key, so the rules can never change.
    #[init]
    pub fn new(params: Params, start_ms: Option<U64>) -> Self {
        if let Err(e) = params.validate() {
            env::panic_str(e);
        }
        let start = start_ms.map(|s| s.0).unwrap_or_else(now_ms);
        let state = State::genesis(&params, start);
        emit(
            "genesis",
            json!({ "total_supply": U128(params.total_supply), "satoshi": U128(params.satoshi_supply), "start_ms": U64(start) }),
        );
        Self {
            params,
            state,
            holders: LookupMap::new(b"h"),
            raids: LookupMap::new(b"r"),
            vault_list: near_sdk::store::Vector::new(b"v"),
            holder_list: near_sdk::store::Vector::new(b"l"),
            feed: LookupMap::new(b"f"),
            feed_count: 0,
            season: None,
            blasts: LookupMap::new(b"b"),
            rounds: LookupMap::new(b"o"),
            last_round: None,
        }
    }

    // ------------------------------------------------------------ helpers

    fn game_parts(&mut self) -> (&Params, &mut State, ChainStore<'_>) {
        (
            &self.params,
            &mut self.state,
            ChainStore { holders: &mut self.holders, raids: &mut self.raids, blasts: &mut self.blasts },
        )
    }

    fn view_store(&self) -> ViewStore<'_> {
        ViewStore { holders: &self.holders, raids: &self.raids, blasts: &self.blasts }
    }

    /// Unclaimed blast coins of a holder (0 off arcade).
    fn pending_of(&self, h: &Holder) -> u128 {
        if self.params.arcade.is_none() || h.dmg == 0 || h.dmg_round >= self.state.round_now(&self.params, now_ms()) {
            return 0;
        }
        let mut st = self.state.clone();
        let mut vs = self.view_store();
        Game::new(&self.params, &mut st, &mut vs).pending_blast(h)
    }

    fn record_round(&mut self, e: RoundEnd) {
        let blasted = e.killer.is_some();
        emit(
            if blasted { "satoshi_blasted" } else { "round_ended" },
            json!({ "round": U64(e.round), "killer": e.killer, "pot": U128(e.pot), "damage": U128(e.damage), "hitters": U64(e.hitters),
                    "burned": U128(e.burned), "respawn": U128(e.respawn), "recycled": U128(e.recycled) }),
        );
        let actor = e.killer.clone().unwrap_or_else(|| "satoshi".to_string());
        self.push_feed(if blasted { "blast" } else { "round" }, &actor, None, e.pot, Some(e.round.to_string()));
        self.rounds.insert(e.round, e.clone());
        self.last_round = Some(e);
    }

    /// Arcade bookkeeping before any move: end a round that ran out of time,
    /// and credit blast shares owed to the accounts this move touches.
    fn arcade_pre(&mut self, ids: &[&str]) {
        if self.params.arcade.is_none() {
            return;
        }
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let mut g = Game::new(p, s, &mut st);
        let ended = g.roll(now);
        let mut paid = vec![];
        for id in ids {
            if let Some((round, coins)) = g.settle(id) {
                paid.push((id.to_string(), round, coins));
            }
        }
        if let Some(e) = ended {
            self.record_round(e);
        }
        for (id, round, coins) in paid {
            emit("blast_claimed", json!({ "account": id, "round": U64(round), "coins": U128(coins) }));
            emit_ft("ft_mint", json!({ "owner_id": id, "amount": U128(coins), "memo": "blast" }));
        }
    }

    fn push_feed(&mut self, kind: &str, actor: &str, target: Option<&str>, amount: u128, extra: Option<String>) {
        let n = self.feed_count;
        let item = FeedItem {
            n: U64(n),
            at: U64(now_ms()),
            kind: kind.to_string(),
            actor: actor.to_string(),
            target: target.map(|t| t.to_string()),
            amount: U128(amount),
            extra,
        };
        self.feed.insert(n % FEED_SIZE, item);
        self.feed_count += 1;
    }

    fn kind_of(&self, id: &AccountId) -> Option<Kind> {
        self.holders.get(id.as_str()).map(|h| h.kind)
    }

    /// The caller must be a registered vault, signing its own transaction
    /// with an ML-DSA-65 key.
    fn require_vault_quantum(&self) -> AccountId {
        let me = env::predecessor_account_id();
        if self.kind_of(&me) != Some(Kind::Vault) {
            fail(Error::NotVault);
        }
        Self::require_quantum_direct(&me);
        me
    }

    fn require_quantum_direct(me: &AccountId) {
        if &env::signer_account_id() != me {
            env::panic_str("E_RELAYED: vault moves must be signed by the vault itself, not relayed");
        }
        let tag = signer_key_tag();
        if tag != ML_DSA_65_TAG {
            env::panic_str(&format!(
                "E_NOT_QUANTUM: signed with key type {tag}; vault moves need an ML-DSA-65 signature"
            ));
        }
    }

    /// Any move of tokens out of a vault needs a quantum signature.
    fn guard_outflow(&self, from: &AccountId) {
        if self.kind_of(from) == Some(Kind::Vault) {
            Self::require_quantum_direct(from);
        }
    }

    fn register_exposed(&mut self, id: &AccountId) {
        let (p, s, mut st) = self.game_parts();
        Game::new(p, s, &mut st).register(id.as_str(), Kind::Exposed).unwrap_or_else(|e| fail(e));
        self.holder_list.push(id.clone());
    }

    fn view_holder(&self, id: &AccountId, h: &Holder) -> HolderView {
        let now = now_ms();
        let epoch = self.state.epoch(&self.params, now);
        let mut v = HolderView {
            account: id.clone(),
            kind: h.kind,
            balance: U128(self.state.balance(h.kind, h.shares)),
            shield_bps: if h.kind == Kind::Vault && h.shield_epoch == epoch { h.shield_bps } else { 0 },
            immune_until: U64(h.immune_until),
            under_raid: h.under_raid.map(U64),
            raids_left: if h.kind != Kind::Vault {
                0
            } else if h.raid_epoch == epoch {
                self.params.max_raids_per_epoch.saturating_sub(h.raids_in_epoch)
            } else {
                self.params.max_raids_per_epoch
            },
            boss_ready: h.kind == Kind::Vault && h.last_boss_epoch != epoch && !self.state.after_q_day(&self.params, now),
            arcade: None,
        };
        if let (Some(a), Kind::Vault) = (&self.params.arcade, h.kind) {
            let (bullets, _) = regen(h.bullets, h.bullet_ts, a.clip_size, a.bullet_regen_ms, now);
            let (shields, _) = regen(h.shields, h.shield_ts, a.shield_max, a.shield_regen_ms, now);
            let pending = self.pending_of(h);
            let round = epoch;
            let (g, l) = h.round_stats(round);
            let (pg, pl) = h.round_stats(round.wrapping_sub(1));
            let pending_round = h.dmg_round;
            let boss_next = if h.last_boss_ms == 0 { 0 } else { h.last_boss_ms + a.boss_cooldown_ms };
            v.balance = U128(v.balance.0 + pending);
            v.raids_left = bullets;
            v.boss_ready = !self.state.after_q_day(&self.params, now) && bullets > 0 && boss_next <= now;
            v.arcade = Some(ArcadeView {
                bullets,
                next_bullet_ms: U64(regen_next(h.bullets, h.bullet_ts, a.clip_size, a.bullet_regen_ms, now)),
                shields,
                next_shield_ms: U64(regen_next(h.shields, h.shield_ts, a.shield_max, a.shield_regen_ms, now)),
                boss_next_ms: U64(if boss_next > now { boss_next } else { 0 }),
                on_break: h.on_break,
                break_since: U64(h.break_since),
                blast_pending: U128(pending),
                blast_round: if pending > 0 { Some(U64(pending_round)) } else { None },
                damage: U128(if h.dmg_round == round { h.dmg } else { 0 }),
                round: U64(round),
                round_gain: U128(g + if pending_round == round { pending } else { 0 }),
                round_loss: U128(l),
                prev_gain: U128(pg + if pending_round.wrapping_add(1) == round { pending } else { 0 }),
                prev_loss: U128(pl),
            });
        }
        v
    }

    // ------------------------------------------------------------ vaults

    /// Create `<name>.<this contract>`, born with exactly one access key: the
    /// given ML-DSA-65 public key (raw 1,952 bytes, base64), full access.
    #[payable]
    pub fn create_vault(&mut self, name: String, pq_public_key: Base64VecU8) -> AccountId {
        let raw: Vec<u8> = pq_public_key.into();
        require!(raw.len() == ML_DSA_65_PUBKEY_LEN, "E_BAD_KEY: expected a raw 1952-byte ML-DSA-65 public key");
        let deposit = env::attached_deposit();
        require!(deposit >= VAULT_MIN_DEPOSIT, "E_DEPOSIT: attach at least 0.2 NEAR to fund your vault");
        require!(
            !name.is_empty() && name.len() <= 32 && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_'),
            "E_BAD_NAME: use lowercase letters, digits, - or _"
        );
        let vault: AccountId = format!("{}.{}", name, env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("E_BAD_NAME"));
        require!(self.kind_of(&vault).is_none(), "E_TAKEN: that vault name is taken");

        let mut borsh_pk = Vec::with_capacity(1 + raw.len());
        borsh_pk.push(ML_DSA_65_TAG);
        borsh_pk.extend_from_slice(&raw);

        let fund: u128 = deposit.as_yoctonear() - STORAGE_COST.as_yoctonear();
        let vault_bytes = vault.as_str().as_bytes();
        let me = env::current_account_id();
        let me_bytes = me.as_str().as_bytes();
        let cb_args = json!({ "vault": vault, "payer": env::predecessor_account_id(), "amount": U128(deposit.as_yoctonear()) })
            .to_string()
            .into_bytes();
        let method = b"on_vault_created";
        let zero: u128 = 0;
        unsafe {
            let p = near_sys::promise_batch_create(vault_bytes.len() as u64, vault_bytes.as_ptr() as u64);
            near_sys::promise_batch_action_create_account(p);
            near_sys::promise_batch_action_transfer(p, &fund as *const u128 as u64);
            near_sys::promise_batch_action_add_key_with_full_access(p, borsh_pk.len() as u64, borsh_pk.as_ptr() as u64, 0);
            let cb = near_sys::promise_then(
                p,
                me_bytes.len() as u64,
                me_bytes.as_ptr() as u64,
                method.len() as u64,
                method.as_ptr() as u64,
                cb_args.len() as u64,
                cb_args.as_ptr() as u64,
                &zero as *const u128 as u64,
                GAS_FOR_VAULT_CALLBACK.as_gas(),
            );
            near_sys::promise_return(cb);
        }
        vault
    }

    /// Registers the vault only if the account was really created.
    #[private]
    pub fn on_vault_created(&mut self, vault: AccountId, payer: AccountId, amount: U128) -> bool {
        let ok = env::promise_result_checked(0, 64).is_ok();
        if ok && self.kind_of(&vault).is_none() {
            let (p, s, mut st) = self.game_parts();
            Game::new(p, s, &mut st).register(vault.as_str(), Kind::Vault).unwrap_or_else(|e| fail(e));
            self.vault_list.push(vault.clone());
            self.holder_list.push(vault.clone());
            emit("vault_created", json!({ "vault": vault, "payer": payer }));
            self.push_feed("vault", vault.as_str(), None, 0, None);
            true
        } else {
            // Account creation failed: the transfer bounced back to us; refund.
            near_sdk::Promise::new(payer).transfer(NearToken::from_yoctonear(amount.0)).detach();
            false
        }
    }

    // ------------------------------------------------------------ market

    /// Buy with attached NEAR. Registers the buyer (0.0025 NEAR) if needed.
    #[payable]
    pub fn buy(&mut self, min_out: Option<U128>) -> U128 {
        let me = env::predecessor_account_id();
        let mut near_in = env::attached_deposit().as_yoctonear();
        match self.kind_of(&me) {
            None => {
                require!(near_in > STORAGE_COST.as_yoctonear(), "E_DEPOSIT: attach more than 0.0025 NEAR");
                near_in -= STORAGE_COST.as_yoctonear();
                self.register_exposed(&me);
            }
            Some(Kind::Vault) => Self::require_quantum_direct(&me),
            Some(Kind::Exposed) => {}
        }
        self.arcade_pre(&[me.as_str()]);
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let o = Game::new(p, s, &mut st)
            .buy(me.as_str(), near_in, min_out.map(|m| m.0).unwrap_or(0), now)
            .unwrap_or_else(|e| fail(e));
        emit_ft("ft_mint", json!({ "owner_id": me, "amount": U128(o.tokens), "memo": "buy" }));
        emit("buy", json!({ "account": me, "near": U128(o.near), "tokens": U128(o.tokens) }));
        self.push_feed("buy", me.as_str(), None, o.tokens, Some(o.near.to_string()));
        U128(o.tokens)
    }

    /// Sell tokens back to the market for NEAR.
    pub fn sell(&mut self, amount: U128, min_near: Option<U128>) -> U128 {
        let me = env::predecessor_account_id();
        self.guard_outflow(&me);
        self.arcade_pre(&[me.as_str()]);
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let o = Game::new(p, s, &mut st)
            .sell(me.as_str(), amount.0, min_near.map(|m| m.0).unwrap_or(0), now)
            .unwrap_or_else(|e| fail(e));
        near_sdk::Promise::new(me.clone()).transfer(NearToken::from_yoctonear(o.near)).detach();
        emit_ft("ft_burn", json!({ "owner_id": me, "amount": U128(o.tokens), "memo": "sell" }));
        emit("sell", json!({ "account": me, "tokens": U128(o.tokens), "near": U128(o.near), "fee": U128(o.fee) }));
        self.push_feed("sell", me.as_str(), None, o.tokens, Some(o.near.to_string()));
        U128(o.near)
    }

    // ------------------------------------------------------------ game

    /// Permissionless: apply every harvest that is due.
    pub fn harvest(&mut self) -> U128 {
        self.arcade_pre(&[]);
        let now = now_ms();
        let actor = env::predecessor_account_id();
        let (p, s, mut st) = self.game_parts();
        let o = Game::new(p, s, &mut st).harvest(now).unwrap_or_else(|e| fail(e));
        emit(
            "harvest",
            json!({ "epochs": U64(o.epochs), "taken": U128(o.taken), "burned": U128(o.burned), "to_vaults": U128(o.to_vaults) }),
        );
        self.push_feed("harvest", actor.as_str(), None, o.taken, Some(o.epochs.to_string()));
        U128(o.taken)
    }

    pub fn raid(&mut self, target: AccountId, stake: U128) -> U64 {
        let me = self.require_vault_quantum();
        self.arcade_pre(&[me.as_str(), target.as_str()]);
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let id = Game::new(p, s, &mut st).raid(me.as_str(), target.as_str(), stake.0, now).unwrap_or_else(|e| fail(e));
        let deadline = now + self.params.defend_window_ms;
        emit("raid_opened", json!({ "id": U64(id), "attacker": me, "target": target, "stake": U128(stake.0), "deadline_ms": U64(deadline) }));
        self.push_feed("raid", me.as_str(), Some(target.as_str()), stake.0, Some(id.to_string()));
        U64(id)
    }

    pub fn defend(&mut self, raid_id: U64) -> U128 {
        let me = self.require_vault_quantum();
        self.arcade_pre(&[me.as_str()]);
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let r = Game::new(p, s, &mut st).defend(me.as_str(), raid_id.0, now).unwrap_or_else(|e| fail(e));
        let won = r.stake - r.burned;
        emit("defended", json!({ "id": raid_id, "attacker": r.attacker, "defender": me, "won": U128(won), "burned": U128(r.burned) }));
        self.push_feed("defend", me.as_str(), Some(r.attacker.as_str()), won, Some(raid_id.0.to_string()));
        U128(won)
    }

    /// Permissionless: settle a raid whose defend window has ended.
    pub fn resolve(&mut self, raid_id: U64) -> U128 {
        self.arcade_pre(&[]);
        let now = now_ms();
        let actor = env::predecessor_account_id();
        let (p, s, mut st) = self.game_parts();
        let r = Game::new(p, s, &mut st).resolve(raid_id.0, now).unwrap_or_else(|e| fail(e));
        emit(
            "resolved",
            json!({ "id": raid_id, "attacker": r.attacker, "target": r.target, "take": U128(r.take), "burned": U128(r.burned), "by": actor }),
        );
        self.push_feed("resolve", r.attacker.as_str(), Some(r.target.as_str()), r.take, Some(raid_id.0.to_string()));
        U128(r.take)
    }

    pub fn charge_shield(&mut self, amount: U128) -> u32 {
        let me = self.require_vault_quantum();
        self.arcade_pre(&[me.as_str()]);
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let strength = Game::new(p, s, &mut st).charge_shield(me.as_str(), amount.0, now).unwrap_or_else(|e| fail(e));
        emit_ft("ft_burn", json!({ "owner_id": me, "amount": amount, "memo": "shield" }));
        emit("shield", json!({ "vault": me, "burned": amount, "shield_bps": strength }));
        self.push_feed("shield", me.as_str(), None, amount.0, Some(strength.to_string()));
        strength
    }

    pub fn boss_raid(&mut self) -> U128 {
        let me = self.require_vault_quantum();
        self.arcade_pre(&[me.as_str()]);
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let o = Game::new(p, s, &mut st).boss_raid(me.as_str(), now).unwrap_or_else(|e| fail(e));
        if self.params.arcade.is_some() {
            // Arcade: a hit is damage only; the coins move when he blasts.
            emit("boss_hit", json!({ "vault": me, "damage": U128(o.taken) }));
            self.push_feed("boss", me.as_str(), None, o.taken, Some("hit".to_string()));
            if let Some(e) = o.round_end {
                self.record_round(e);
            }
            return U128(o.taken);
        }
        emit("boss_raid", json!({ "vault": me, "taken": U128(o.taken), "burned": U128(o.burned), "gained": U128(o.gained) }));
        self.push_feed("boss", me.as_str(), None, o.taken, None);
        U128(o.gained)
    }

    /// Arcade: answer a raid with a shield charge. The raid fails; the stake,
    /// less the burn, goes to you.
    pub fn block(&mut self, raid_id: U64) -> U128 {
        let me = self.require_vault_quantum();
        self.arcade_pre(&[me.as_str()]);
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let r = Game::new(p, s, &mut st).block(me.as_str(), raid_id.0, now).unwrap_or_else(|e| fail(e));
        let won = r.stake - r.burned;
        emit("blocked", json!({ "id": raid_id, "attacker": r.attacker, "defender": me, "won": U128(won), "burned": U128(r.burned) }));
        self.push_feed("block", me.as_str(), Some(r.attacker.as_str()), won, Some(raid_id.0.to_string()));
        U128(won)
    }

    /// Arcade: burn `reload_price` coins and fill the clip.
    pub fn reload(&mut self) -> U128 {
        let me = self.require_vault_quantum();
        self.arcade_pre(&[me.as_str()]);
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let burned = Game::new(p, s, &mut st).reload(me.as_str(), now).unwrap_or_else(|e| fail(e));
        emit_ft("ft_burn", json!({ "owner_id": me, "amount": U128(burned), "memo": "reload" }));
        emit("reload", json!({ "vault": me, "burned": U128(burned) }));
        self.push_feed("reload", me.as_str(), None, burned, None);
        U128(burned)
    }

    /// Arcade: burn `shield_price` coins for one shield charge.
    pub fn buy_shield(&mut self) -> u32 {
        let me = self.require_vault_quantum();
        self.arcade_pre(&[me.as_str()]);
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        let charges = Game::new(p, s, &mut st).buy_shield(me.as_str(), now).unwrap_or_else(|e| fail(e));
        let price = self.params.arcade.as_ref().map(|a| a.shield_price).unwrap_or(0);
        emit_ft("ft_burn", json!({ "owner_id": me, "amount": U128(price), "memo": "shield" }));
        emit("shield_bought", json!({ "vault": me, "burned": U128(price), "charges": charges }));
        self.push_feed("shield", me.as_str(), None, price, Some(charges.to_string()));
        charges
    }

    /// Arcade: take a break (the game's bots leave you alone) or come back.
    pub fn set_break(&mut self, on: bool) {
        let me = self.require_vault_quantum();
        self.arcade_pre(&[me.as_str()]);
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        Game::new(p, s, &mut st).set_break(me.as_str(), on, now).unwrap_or_else(|e| fail(e));
        emit("break", json!({ "vault": me, "on": on }));
        self.push_feed("break", me.as_str(), None, 0, Some(if on { "on" } else { "off" }.to_string()));
    }

    /// Arcade, permissionless: credit a vault its share of a Satoshi blast.
    /// Shares are also credited on the vault's next move, so calling this is
    /// only ever early, never needed. Returns the coins credited.
    pub fn claim_blast(&mut self, account_id: Option<AccountId>) -> U128 {
        let who = account_id.unwrap_or_else(env::predecessor_account_id);
        require!(self.params.arcade.is_some(), Error::NotArcade.code());
        let before = self.holders.get(who.as_str()).map(|h| (h.dmg, h.dmg_round));
        require!(matches!(before, Some((d, _)) if d > 0), "E_NOTHING_TO_CLAIM: no blast share waiting");
        let earned = self.holders.get(who.as_str()).map(|h| self.pending_of(h)).unwrap_or(0);
        self.arcade_pre(&[who.as_str()]);
        require!(earned > 0, "E_NOTHING_TO_CLAIM: no blast share waiting");
        U128(earned)
    }

    /// Permissionless, after Q-Day: write the season result on chain once.
    pub fn finalize(&mut self) -> SeasonResult {
        let now = now_ms();
        require!(self.state.after_q_day(&self.params, now), "E_SEASON_RUNNING: Q-Day has not arrived");
        require!(self.season.is_none(), "E_FINALIZED");
        let count = self.vault_list.len();
        let mut top: Vec<(AccountId, U128)> = vec![];
        for i in 0..count.min(2_000) {
            let v = self.vault_list[i].clone();
            if let Some(h) = self.holders.get(v.as_str()) {
                top.push((v, U128(self.state.balance(h.kind, h.shares))));
            }
        }
        top.sort_by(|a, b| b.1 .0.cmp(&a.1 .0));
        top.truncate(10);
        let r = SeasonResult {
            finalized_at: U64(now),
            frozen_exposed: U128(self.state.e_tokens),
            satoshi_frozen: U128(self.state.satoshi_balance()),
            vault_total: U128(self.state.q_tokens),
            vaults: U64(self.state.vaults),
            burned: U128(self.state.burned),
            top_vaults: top,
        };
        emit("season_finalized", json!({ "frozen_exposed": r.frozen_exposed, "vault_total": r.vault_total, "vaults": r.vaults }));
        self.season = Some(r.clone());
        r
    }

    // ------------------------------------------------------------ views

    pub fn config(&self) -> &Params {
        &self.params
    }

    pub fn stats(&self) -> Stats {
        let now = now_ms();
        let p = &self.params;
        let s = &self.state;
        let epoch = s.epoch(p, now);
        let (_, epoch_ends) = s.epoch_bounds(p, now);
        let held = s.e_tokens + s.q_tokens;
        Stats {
            now_ms: U64(now),
            epoch: U64(epoch),
            epoch_ends_ms: U64(epoch_ends),
            q_day_ms: U64(s.q_day_ms(p)),
            after_q_day: s.after_q_day(p, now),
            harvest_due: s.harvested < s.harvest_due_total(p, now),
            harvested: U64(s.harvested),
            exposed_tokens: U128(s.e_tokens),
            vault_tokens: U128(s.q_tokens),
            satoshi_tokens: U128(s.satoshi_balance()),
            market_tokens: U128(s.curve_left(p)),
            escrow: U128(s.escrow),
            burned: U128(s.burned),
            circulating: U128(s.circulating(p)),
            near_reserve: U128(s.near_reserve),
            price_yocto_per_token: U128(spot_price(p, s)),
            vaults: U64(s.vaults),
            exposed_holders: U64(s.exposed_holders),
            raids: U64(s.next_raid_id - 1),
            vault_share_bps: if held == 0 { 0 } else { (s.q_tokens * 10_000 / held) as u32 },
        }
    }

    pub fn holder(&self, account_id: AccountId) -> Option<HolderView> {
        self.holders.get(account_id.as_str()).map(|h| self.view_holder(&account_id, h))
    }

    pub fn get_raid(&self, raid_id: U64) -> Option<Raid> {
        self.raids.get(&raid_id.0).cloned()
    }

    /// Latest moves, newest first.
    pub fn feed(&self, limit: Option<u64>) -> Vec<FeedItem> {
        let limit = limit.unwrap_or(30).min(FEED_SIZE);
        let mut out = vec![];
        let mut n = self.feed_count;
        while n > 0 && (out.len() as u64) < limit && self.feed_count - n < FEED_SIZE {
            n -= 1;
            if let Some(i) = self.feed.get(&(n % FEED_SIZE)) {
                out.push(i.clone());
            }
        }
        out
    }

    pub fn vaults(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<HolderView> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(200);
        (from..(from + limit).min(self.vault_list.len()))
            .filter_map(|i| {
                let v = self.vault_list[i].clone();
                self.holders.get(v.as_str()).map(|h| self.view_holder(&v, h))
            })
            .collect()
    }

    /// Every holder (exposed wallets and vaults), in order of arrival.
    pub fn holders(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<HolderView> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(200);
        (from..(from + limit).min(self.holder_list.len()))
            .filter_map(|i| {
                let v = self.holder_list[i].clone();
                self.holders.get(v.as_str()).map(|h| self.view_holder(&v, h))
            })
            .collect()
    }

    pub fn holder_count(&self) -> u32 {
        self.holder_list.len()
    }

    /// Open raids among the latest `scan` raids (default 100), newest first.
    pub fn open_raids(&self, scan: Option<u64>) -> Vec<Raid> {
        let last = self.state.next_raid_id.saturating_sub(1);
        let lo = last.saturating_sub(scan.unwrap_or(100).min(300));
        ((lo + 1)..=last)
            .rev()
            .filter_map(|id| self.raids.get(&id).cloned())
            .filter(|r| r.status == qday_core::RaidStatus::Open)
            .collect()
    }

    pub fn season(&self) -> Option<SeasonResult> {
        self.season.clone()
    }

    /// Arcade: the round and Satoshi's life bar (None on older seasons).
    pub fn arena(&self) -> Option<ArenaView> {
        self.params.arcade.as_ref()?;
        let now = now_ms();
        let p = &self.params;
        let s = &self.state;
        let round = s.epoch(p, now);
        let (start, end) = s.epoch_bounds(p, now);
        let timed_out = round > s.round;
        let stash = s.satoshi_balance();
        let damage = if timed_out { 0 } else { s.round_damage };
        Some(ArenaView {
            now_ms: U64(now),
            round: U64(round),
            round_started_ms: U64(start),
            round_ends_ms: U64(end),
            boss_hp: U128(stash.saturating_sub(damage)),
            boss_spawn: U128(s.boss_spawn),
            boss_stash: U128(stash),
            damage: U128(damage),
            hitters: U64(if timed_out { 0 } else { s.round_hitters }),
            reserve: U128(s.sat_reserve),
            kills: U64(s.kills),
            round_burned: U128(if timed_out { 0 } else { s.burned - s.round_burn_start }),
            blast_escrow: U128(s.blast_escrow),
            last_round: self.last_round.clone(),
        })
    }

    /// A finished arcade round.
    pub fn round(&self, round: U64) -> Option<RoundEnd> {
        self.rounds.get(&round.0).cloned()
    }

    /// The last `limit` finished rounds (default 10, at most 50), newest first.
    pub fn rounds(&self, limit: Option<u64>) -> Vec<RoundEnd> {
        let Some(last) = &self.last_round else { return vec![] };
        let mut out = vec![];
        let mut r = last.round + 1;
        while r > 0 && (out.len() as u64) < limit.unwrap_or(10).min(50) {
            r -= 1;
            if let Some(e) = self.rounds.get(&r) {
                out.push(e.clone());
            }
            if last.round - r > 200 {
                break;
            }
        }
        out
    }

    /// A Satoshi blast pot (shared by damage).
    pub fn blast(&self, round: U64) -> Option<Blast> {
        self.blasts.get(&round.0).cloned()
    }

    pub fn quote_buy(&self, near: U128) -> Option<U128> {
        core_quote_buy(&self.params, &self.state, near.0).map(U128)
    }

    pub fn quote_sell(&self, amount: U128) -> Option<U128> {
        let fee = qday_core::math::bps(amount.0, self.params.sell_fee_bps);
        core_quote_sell(&self.params, &self.state, amount.0 - fee).map(U128)
    }

    // ------------------------------------------------------------ NEP-141

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        near_sdk::assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo);
    }

    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        near_sdk::assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo);
        let on_transfer = near_sdk::Promise::new(receiver_id.clone()).function_call(
            "ft_on_transfer".to_string(),
            json!({ "sender_id": sender, "amount": amount, "msg": msg }).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_FOR_FT_ON_TRANSFER,
        );
        let resolve = near_sdk::Promise::new(env::current_account_id()).function_call(
            "ft_resolve_transfer".to_string(),
            json!({ "sender_id": sender, "receiver_id": receiver_id, "amount": amount }).to_string().into_bytes(),
            NearToken::from_yoctonear(0),
            GAS_FOR_RESOLVE_TRANSFER,
        );
        PromiseOrValue::Promise(on_transfer.then(resolve))
    }

    #[private]
    pub fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let unused = match env::promise_result_checked(0, 128) {
            Ok(v) => serde_json::from_slice::<U128>(&v).map(|u| u.0.min(amount.0)).unwrap_or(amount.0),
            Err(_) => amount.0,
        };
        let mut used = amount.0;
        if unused > 0 {
            let now = now_ms();
            let (p, s, mut st) = self.game_parts();
            let mut g = Game::new(p, s, &mut st);
            let refund = unused.min(g.balance_of(receiver_id.as_str()));
            if refund > 0 && g.transfer(receiver_id.as_str(), sender_id.as_str(), refund, now).is_ok() {
                emit_ft("ft_transfer", json!({ "old_owner_id": receiver_id, "new_owner_id": sender_id, "amount": U128(refund), "memo": "refund" }));
                used = amount.0 - refund;
            }
        }
        U128(used)
    }

    fn internal_transfer(&mut self, from: &AccountId, to: &AccountId, amount: u128, memo: Option<String>) {
        self.guard_outflow(from);
        self.arcade_pre(&[from.as_str(), to.as_str()]);
        let now = now_ms();
        let (p, s, mut st) = self.game_parts();
        Game::new(p, s, &mut st).transfer(from.as_str(), to.as_str(), amount, now).unwrap_or_else(|e| fail(e));
        emit_ft("ft_transfer", json!({ "old_owner_id": from, "new_owner_id": to, "amount": U128(amount), "memo": memo }));
        let migrated = self.kind_of(from) == Some(Kind::Exposed) && self.kind_of(to) == Some(Kind::Vault);
        self.push_feed(if migrated { "migrate" } else { "transfer" }, from.as_str(), Some(to.as_str()), amount, None);
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.state.circulating(&self.params))
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.holders.get(account_id.as_str()).map(|h| self.state.balance(h.kind, h.shares) + self.pending_of(h)).unwrap_or(0))
    }

    pub fn ft_metadata(&self) -> serde_json::Value {
        json!({
            "spec": "ft-1.0.0",
            "name": "KEYFALL",
            "symbol": "KEYFALL",
            "icon": ICON,
            "reference": null,
            "reference_hash": null,
            "decimals": DECIMALS,
        })
    }

    // ------------------------------------------------------------ NEP-145

    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> serde_json::Value {
        let _ = registration_only;
        let id = account_id.unwrap_or_else(env::predecessor_account_id);
        let deposit = env::attached_deposit();
        if self.kind_of(&id).is_some() {
            if deposit.as_yoctonear() > 0 {
                near_sdk::Promise::new(env::predecessor_account_id()).transfer(deposit).detach();
            }
        } else {
            require!(deposit >= STORAGE_COST, "E_DEPOSIT: storage costs 0.0025 NEAR");
            self.register_exposed(&id);
            let refund = deposit.as_yoctonear() - STORAGE_COST.as_yoctonear();
            if refund > 0 {
                near_sdk::Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(refund)).detach();
            }
        }
        json!({ "total": U128(STORAGE_COST.as_yoctonear()), "available": "0" })
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<serde_json::Value> {
        self.kind_of(&account_id).map(|_| json!({ "total": U128(STORAGE_COST.as_yoctonear()), "available": "0" }))
    }

    pub fn storage_balance_bounds(&self) -> serde_json::Value {
        json!({ "min": U128(STORAGE_COST.as_yoctonear()), "max": U128(STORAGE_COST.as_yoctonear()) })
    }

    #[payable]
    pub fn storage_withdraw(&mut self, amount: Option<U128>) -> serde_json::Value {
        near_sdk::assert_one_yocto();
        require!(amount.map_or(true, |a| a.0 == 0), "E_NOTHING_TO_WITHDRAW");
        json!({ "total": U128(STORAGE_COST.as_yoctonear()), "available": "0" })
    }

    #[payable]
    pub fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        near_sdk::assert_one_yocto();
        let _ = force;
        false
    }
}

const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230a0a0a'/%3E%3Ccircle cx='32' cy='32' r='17' fill='none' stroke='%23d4ff3a' stroke-width='6'/%3E%3Cpath d='M40 40l11 11' stroke='%23d4ff3a' stroke-width='6' stroke-linecap='round'/%3E%3C/svg%3E";

#[cfg(test)]
mod tests;
