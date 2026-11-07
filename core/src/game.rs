//! The Q-DAY rules. Pure: no chain code, time is passed in, storage is a trait.
//! The contract and the simulation both call these functions.

use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};

use crate::math::{bps, div_ceil_256, isqrt, mul_div, mul_div_ceil, U256};
use crate::params::{u128_str, Params};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// Any normal account. Bleeds, cannot defend, freezes at Q-Day.
    Exposed,
    /// A quantum vault created by the game, born with only an ML-DSA-65 key.
    Vault,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct Holder {
    pub kind: Kind,
    /// Shares of the holder's bucket (exposed or vault).
    #[serde(with = "u128_str")]
    pub shares: u128,
    /// Shield strength, valid only during `shield_epoch`.
    pub shield_bps: u32,
    pub shield_epoch: u64,
    /// Raids against this holder are refused until this time (ms).
    pub immune_until: u64,
    /// Epoch of the last boss raid (u64::MAX = never).
    pub last_boss_epoch: u64,
    /// Raid counter for `raid_epoch`.
    pub raid_epoch: u64,
    pub raids_in_epoch: u32,
    /// Open raid against this holder, if any.
    pub under_raid: Option<u64>,
}

impl Holder {
    pub fn new(kind: Kind) -> Self {
        Holder {
            kind,
            shares: 0,
            shield_bps: 0,
            shield_epoch: u64::MAX,
            immune_until: 0,
            last_boss_epoch: u64::MAX,
            raid_epoch: u64::MAX,
            raids_in_epoch: 0,
            under_raid: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
#[serde(rename_all = "lowercase")]
pub enum RaidStatus {
    Open,
    Defended,
    Resolved,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct Raid {
    pub id: u64,
    pub attacker: String,
    pub target: String,
    pub target_kind: Kind,
    #[serde(with = "u128_str")]
    pub stake: u128,
    pub opened_at: u64,
    pub deadline: u64,
    pub status: RaidStatus,
    /// Tokens taken from the target (resolved raids).
    #[serde(with = "u128_str")]
    pub take: u128,
    /// Tokens burned when the raid ended.
    #[serde(with = "u128_str")]
    pub burned: u128,
}

/// Global state of a season.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct State {
    pub start_ms: u64,
    #[serde(with = "u128_str")]
    pub e_tokens: u128,
    #[serde(with = "u128_str")]
    pub e_shares: u128,
    #[serde(with = "u128_str")]
    pub q_tokens: u128,
    #[serde(with = "u128_str")]
    pub q_shares: u128,
    /// Satoshi's shares of the exposed bucket.
    #[serde(with = "u128_str")]
    pub satoshi_shares: u128,
    /// Tokens sold out of the curve (net of tokens sold back).
    #[serde(with = "u128_str")]
    pub sold: u128,
    /// Real NEAR held by the curve (yocto).
    #[serde(with = "u128_str")]
    pub near_reserve: u128,
    /// Raid stakes held in escrow.
    #[serde(with = "u128_str")]
    pub escrow: u128,
    #[serde(with = "u128_str")]
    pub burned: u128,
    /// Number of epochs already harvested.
    pub harvested: u64,
    pub next_raid_id: u64,
    pub vaults: u64,
    pub exposed_holders: u64,
}

pub trait Store {
    fn holder(&self, id: &str) -> Option<Holder>;
    fn put_holder(&mut self, id: &str, h: Holder);
    fn raid(&self, id: u64) -> Option<Raid>;
    fn put_raid(&mut self, r: Raid);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Zero,
    UnknownHolder,
    AlreadyRegistered,
    NotVault,
    SameAccount,
    QDayPassed,
    Frozen,
    Insufficient,
    Slippage,
    ReserveCap,
    CurveEmpty,
    CurveFull,
    NothingDue,
    TargetInvalid,
    TargetImmune,
    TargetBusy,
    TargetTooSmall,
    StakeTooSmall,
    RaidLimit,
    RaidNotOpen,
    NotTarget,
    WindowClosed,
    WindowOpen,
    BossDone,
    BossMinBalance,
    BossEmpty,
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Error::Zero => "E_ZERO: amount must be positive",
            Error::UnknownHolder => "E_UNKNOWN_HOLDER: account is not registered",
            Error::AlreadyRegistered => "E_ALREADY_REGISTERED",
            Error::NotVault => "E_NOT_VAULT: only a quantum vault can do this",
            Error::SameAccount => "E_SAME_ACCOUNT",
            Error::QDayPassed => "E_QDAY_PASSED: the season is over",
            Error::Frozen => "E_FROZEN: exposed balances are frozen after Q-Day",
            Error::Insufficient => "E_INSUFFICIENT: balance too low",
            Error::Slippage => "E_SLIPPAGE: price moved past your limit",
            Error::ReserveCap => "E_RESERVE_CAP: the market reserve is at its cap",
            Error::CurveEmpty => "E_CURVE_EMPTY: the market has no tokens left to sell",
            Error::CurveFull => "E_CURVE_FULL: the market can only buy back what it sold",
            Error::NothingDue => "E_NOTHING_DUE: no harvest is due yet",
            Error::TargetInvalid => "E_TARGET_INVALID",
            Error::TargetImmune => "E_TARGET_IMMUNE: target was raided recently",
            Error::TargetBusy => "E_TARGET_BUSY: target is already under raid",
            Error::TargetTooSmall => "E_TARGET_TOO_SMALL",
            Error::StakeTooSmall => "E_STAKE_TOO_SMALL",
            Error::RaidLimit => "E_RAID_LIMIT: no raids left this epoch",
            Error::RaidNotOpen => "E_RAID_NOT_OPEN",
            Error::NotTarget => "E_NOT_TARGET: only the target can defend",
            Error::WindowClosed => "E_WINDOW_CLOSED: the defend window has ended",
            Error::WindowOpen => "E_WINDOW_OPEN: the defend window is still open",
            Error::BossDone => "E_BOSS_DONE: already hit Satoshi this epoch",
            Error::BossMinBalance => "E_BOSS_MIN_BALANCE: vault balance too low to hit Satoshi",
            Error::BossEmpty => "E_BOSS_EMPTY: Satoshi has nothing left",
        }
    }
}

pub type Res<T> = Result<T, Error>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Bucket {
    E,
    Q,
}

fn bucket_of(k: Kind) -> Bucket {
    match k {
        Kind::Exposed => Bucket::E,
        Kind::Vault => Bucket::Q,
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarvestOutcome {
    pub epochs: u64,
    #[serde(with = "u128_str")]
    pub taken: u128,
    #[serde(with = "u128_str")]
    pub burned: u128,
    #[serde(with = "u128_str")]
    pub to_vaults: u128,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TradeOutcome {
    #[serde(with = "u128_str")]
    pub tokens: u128,
    #[serde(with = "u128_str")]
    pub near: u128,
    #[serde(with = "u128_str")]
    pub fee: u128,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BossOutcome {
    #[serde(with = "u128_str")]
    pub taken: u128,
    #[serde(with = "u128_str")]
    pub burned: u128,
    #[serde(with = "u128_str")]
    pub gained: u128,
}

pub struct Game<'a, S: Store> {
    pub p: &'a Params,
    pub s: &'a mut State,
    pub store: &'a mut S,
}

impl State {
    pub fn genesis(p: &Params, start_ms: u64) -> State {
        State {
            start_ms,
            e_tokens: p.satoshi_supply,
            e_shares: p.satoshi_supply,
            q_tokens: 0,
            q_shares: 0,
            satoshi_shares: p.satoshi_supply,
            sold: 0,
            near_reserve: 0,
            escrow: 0,
            burned: 0,
            harvested: 0,
            next_raid_id: 1,
            vaults: 0,
            exposed_holders: 0,
        }
    }

    pub fn epoch(&self, p: &Params, now: u64) -> u64 {
        now.saturating_sub(self.start_ms) / p.epoch_ms
    }

    pub fn q_day_ms(&self, p: &Params) -> u64 {
        self.start_ms + p.epoch_ms * p.season_epochs
    }

    pub fn after_q_day(&self, p: &Params, now: u64) -> bool {
        now >= self.q_day_ms(p)
    }

    pub fn curve_left(&self, p: &Params) -> u128 {
        p.curve_supply() - self.sold
    }

    /// Supply that still exists (not burned).
    pub fn circulating(&self, p: &Params) -> u128 {
        p.total_supply - self.burned
    }

    /// Accounting invariant. True in every reachable state.
    pub fn balanced(&self, p: &Params) -> bool {
        self.e_tokens + self.q_tokens + self.curve_left(p) + self.escrow + self.burned == p.total_supply
    }

    pub fn satoshi_balance(&self) -> u128 {
        if self.e_shares == 0 {
            0
        } else {
            mul_div(self.satoshi_shares, self.e_tokens, self.e_shares)
        }
    }

    fn totals(&self, b: Bucket) -> (u128, u128) {
        match b {
            Bucket::E => (self.e_tokens, self.e_shares),
            Bucket::Q => (self.q_tokens, self.q_shares),
        }
    }

    fn set_totals(&mut self, b: Bucket, tokens: u128, shares: u128) {
        match b {
            Bucket::E => {
                self.e_tokens = tokens;
                self.e_shares = shares;
            }
            Bucket::Q => {
                self.q_tokens = tokens;
                self.q_shares = shares;
            }
        }
    }

    /// Balance for `shares` of a kind's bucket.
    pub fn balance(&self, kind: Kind, shares: u128) -> u128 {
        let (t, s) = self.totals(bucket_of(kind));
        if s == 0 {
            0
        } else {
            mul_div(shares, t, s)
        }
    }

    /// Add `amount` tokens to a bucket; returns the shares minted.
    fn deposit(&mut self, b: Bucket, amount: u128) -> u128 {
        let (t, s) = self.totals(b);
        let minted = if s == 0 || t == 0 { amount } else { mul_div(amount, s, t) };
        self.set_totals(b, t + amount, s + minted);
        minted
    }

    /// Remove `amount` tokens from a bucket for a holder with `have` shares;
    /// returns the shares burned.
    fn withdraw(&mut self, b: Bucket, have: u128, amount: u128) -> Res<u128> {
        let (t, s) = self.totals(b);
        if s == 0 || t == 0 {
            return Err(Error::Insufficient);
        }
        let need = mul_div_ceil(amount, s, t);
        if need > have || amount > t {
            return Err(Error::Insufficient);
        }
        self.set_totals(b, t - amount, s - need);
        Ok(need)
    }
}

/// Shield strength for burning `amount` out of `balance`: sqrt of the share
/// burned, so 1% gives 10%, 4% gives 20%, 9% gives 30%, capped.
pub fn shield_strength(p: &Params, amount: u128, balance: u128) -> u32 {
    if balance == 0 {
        return 0;
    }
    let ratio_bps = mul_div(amount, 10_000, balance).min(10_000);
    let s = isqrt(ratio_bps * 10_000) as u32;
    s.min(p.max_shield_bps)
}

/// Tokens a buy of `near_in` returns, or None if the curve cannot serve it.
pub fn quote_buy(p: &Params, s: &State, near_in: u128) -> Option<u128> {
    let k = U256::from(p.curve_virtual_near) * U256::from(p.curve_virtual_tokens);
    let x = p.curve_virtual_near + s.near_reserve;
    let y = p.curve_virtual_tokens - s.sold;
    let new_y = div_ceil_256(k, x + near_in);
    let out = y.checked_sub(new_y)?;
    if out == 0 || out > s.curve_left(p) {
        None
    } else {
        Some(out)
    }
}

/// NEAR a sell of `net_tokens` (after fee) returns.
pub fn quote_sell(p: &Params, s: &State, net_tokens: u128) -> Option<u128> {
    if net_tokens > s.sold {
        return None;
    }
    let k = U256::from(p.curve_virtual_near) * U256::from(p.curve_virtual_tokens);
    let x = p.curve_virtual_near + s.near_reserve;
    let y = p.curve_virtual_tokens - s.sold;
    let new_x = div_ceil_256(k, y + net_tokens);
    let out = x.checked_sub(new_x)?;
    if out > s.near_reserve {
        None
    } else {
        Some(out)
    }
}

/// Current spot price in yocto NEAR per whole token.
pub fn spot_price(p: &Params, s: &State) -> u128 {
    let x = p.curve_virtual_near + s.near_reserve;
    let y = p.curve_virtual_tokens - s.sold;
    mul_div(x, crate::params::ONE, y)
}

impl<'a, S: Store> Game<'a, S> {
    pub fn new(p: &'a Params, s: &'a mut State, store: &'a mut S) -> Self {
        Game { p, s, store }
    }

    fn get(&self, id: &str) -> Res<Holder> {
        self.store.holder(id).ok_or(Error::UnknownHolder)
    }

    pub fn balance_of(&self, id: &str) -> u128 {
        match self.store.holder(id) {
            Some(h) => self.s.balance(h.kind, h.shares),
            None => 0,
        }
    }

    fn effective_shield(&self, h: &Holder, now: u64) -> u32 {
        if h.kind == Kind::Vault && h.shield_epoch == self.s.epoch(self.p, now) {
            h.shield_bps
        } else {
            0
        }
    }

    fn credit(&mut self, id: &str, h: &mut Holder, amount: u128) {
        if amount == 0 {
            return;
        }
        let minted = self.s.deposit(bucket_of(h.kind), amount);
        h.shares += minted;
        let _ = id;
    }

    fn debit(&mut self, h: &mut Holder, amount: u128) -> Res<()> {
        if amount == 0 {
            return Ok(());
        }
        let burned_shares = self.s.withdraw(bucket_of(h.kind), h.shares, amount)?;
        h.shares -= burned_shares;
        Ok(())
    }

    /// Register a holder. Vault registration happens only when the contract
    /// creates the quantum-only account.
    pub fn register(&mut self, id: &str, kind: Kind) -> Res<()> {
        if self.store.holder(id).is_some() {
            return Err(Error::AlreadyRegistered);
        }
        self.store.put_holder(id, Holder::new(kind));
        match kind {
            Kind::Vault => self.s.vaults += 1,
            Kind::Exposed => self.s.exposed_holders += 1,
        }
        Ok(())
    }

    pub fn is_registered(&self, id: &str) -> bool {
        self.store.holder(id).is_some()
    }

    // ---------------------------------------------------------------- harvest

    pub fn harvest(&mut self, now: u64) -> Res<HarvestOutcome> {
        let due_total = self.s.epoch(self.p, now).min(self.p.season_epochs);
        if self.s.harvested >= due_total {
            return Err(Error::NothingDue);
        }
        let mut out = HarvestOutcome { epochs: 0, taken: 0, burned: 0, to_vaults: 0 };
        // At most 64 missed epochs per call keeps gas bounded.
        while self.s.harvested < due_total && out.epochs < 64 {
            let h = bps(self.s.e_tokens, self.p.harvest_bps);
            let (burn, to_q) = if self.s.q_shares == 0 { (h, 0) } else { (h / 2, h - h / 2) };
            self.s.e_tokens -= h;
            self.s.q_tokens += to_q;
            self.s.burned += burn;
            self.s.harvested += 1;
            out.epochs += 1;
            out.taken += h;
            out.burned += burn;
            out.to_vaults += to_q;
        }
        Ok(out)
    }

    // ---------------------------------------------------------------- transfer

    pub fn transfer(&mut self, from: &str, to: &str, amount: u128, now: u64) -> Res<()> {
        if amount == 0 {
            return Err(Error::Zero);
        }
        if from == to {
            return Err(Error::SameAccount);
        }
        let mut hf = self.get(from)?;
        let mut ht = self.get(to)?;
        if self.s.after_q_day(self.p, now) && (hf.kind == Kind::Exposed || ht.kind == Kind::Exposed) {
            return Err(Error::Frozen);
        }
        self.debit(&mut hf, amount)?;
        self.credit(to, &mut ht, amount);
        self.store.put_holder(from, hf);
        self.store.put_holder(to, ht);
        Ok(())
    }

    // ---------------------------------------------------------------- market

    pub fn buy(&mut self, buyer: &str, near_in: u128, min_out: u128, now: u64) -> Res<TradeOutcome> {
        if near_in == 0 {
            return Err(Error::Zero);
        }
        let mut h = self.get(buyer)?;
        if self.s.after_q_day(self.p, now) && h.kind == Kind::Exposed {
            return Err(Error::Frozen);
        }
        if self.s.near_reserve + near_in > self.p.reserve_cap {
            return Err(Error::ReserveCap);
        }
        let out = quote_buy(self.p, self.s, near_in).ok_or(Error::CurveEmpty)?;
        if out < min_out {
            return Err(Error::Slippage);
        }
        self.s.sold += out;
        self.s.near_reserve += near_in;
        self.credit(buyer, &mut h, out);
        self.store.put_holder(buyer, h);
        Ok(TradeOutcome { tokens: out, near: near_in, fee: 0 })
    }

    pub fn sell(&mut self, seller: &str, amount: u128, min_near: u128, now: u64) -> Res<TradeOutcome> {
        if amount == 0 {
            return Err(Error::Zero);
        }
        let mut h = self.get(seller)?;
        if self.s.after_q_day(self.p, now) && h.kind == Kind::Exposed {
            return Err(Error::Frozen);
        }
        let fee = bps(amount, self.p.sell_fee_bps);
        let net = amount - fee;
        let near_out = quote_sell(self.p, self.s, net).ok_or(Error::CurveFull)?;
        if near_out < min_near {
            return Err(Error::Slippage);
        }
        self.debit(&mut h, amount)?;
        self.store.put_holder(seller, h);
        let (fee_burn, fee_q) = if self.s.q_shares == 0 { (fee, 0) } else { (fee / 2, fee - fee / 2) };
        self.s.sold -= net;
        self.s.near_reserve -= near_out;
        self.s.burned += fee_burn;
        self.s.q_tokens += fee_q;
        Ok(TradeOutcome { tokens: amount, near: near_out, fee })
    }

    // ---------------------------------------------------------------- shields

    pub fn charge_shield(&mut self, id: &str, amount: u128, now: u64) -> Res<u32> {
        if amount == 0 {
            return Err(Error::Zero);
        }
        if self.s.after_q_day(self.p, now) {
            return Err(Error::QDayPassed);
        }
        let mut h = self.get(id)?;
        if h.kind != Kind::Vault {
            return Err(Error::NotVault);
        }
        let bal = self.s.balance(h.kind, h.shares);
        if amount > bal {
            return Err(Error::Insufficient);
        }
        let strength = shield_strength(self.p, amount, bal);
        self.debit(&mut h, amount)?;
        self.s.burned += amount;
        let epoch = self.s.epoch(self.p, now);
        let current = if h.shield_epoch == epoch { h.shield_bps } else { 0 };
        h.shield_bps = current.max(strength);
        h.shield_epoch = epoch;
        let result = h.shield_bps;
        self.store.put_holder(id, h);
        Ok(result)
    }

    // ---------------------------------------------------------------- raids

    pub fn raid(&mut self, attacker: &str, target: &str, stake: u128, now: u64) -> Res<u64> {
        if self.s.after_q_day(self.p, now) {
            return Err(Error::QDayPassed);
        }
        if attacker == target {
            return Err(Error::SameAccount);
        }
        let mut ha = self.get(attacker)?;
        if ha.kind != Kind::Vault {
            return Err(Error::NotVault);
        }
        let mut ht = self.store.holder(target).ok_or(Error::TargetInvalid)?;
        if stake < self.p.min_stake {
            return Err(Error::StakeTooSmall);
        }
        if ht.under_raid.is_some() {
            return Err(Error::TargetBusy);
        }
        if ht.immune_until > now {
            return Err(Error::TargetImmune);
        }
        if self.s.balance(ht.kind, ht.shares) < self.p.min_target_balance {
            return Err(Error::TargetTooSmall);
        }
        let epoch = self.s.epoch(self.p, now);
        if ha.raid_epoch != epoch {
            ha.raid_epoch = epoch;
            ha.raids_in_epoch = 0;
        }
        if ha.raids_in_epoch >= self.p.max_raids_per_epoch {
            return Err(Error::RaidLimit);
        }
        self.debit(&mut ha, stake)?;
        self.s.escrow += stake;
        ha.raids_in_epoch += 1;

        let id = self.s.next_raid_id;
        self.s.next_raid_id += 1;
        ht.under_raid = Some(id);
        let raid = Raid {
            id,
            attacker: attacker.to_string(),
            target: target.to_string(),
            target_kind: ht.kind,
            stake,
            opened_at: now,
            deadline: now + self.p.defend_window_ms,
            status: RaidStatus::Open,
            take: 0,
            burned: 0,
        };
        self.store.put_holder(attacker, ha);
        self.store.put_holder(target, ht);
        self.store.put_raid(raid);
        Ok(id)
    }

    pub fn defend(&mut self, defender: &str, raid_id: u64, now: u64) -> Res<Raid> {
        let mut r = self.store.raid(raid_id).ok_or(Error::RaidNotOpen)?;
        if r.status != RaidStatus::Open {
            return Err(Error::RaidNotOpen);
        }
        if r.target != defender {
            return Err(Error::NotTarget);
        }
        let mut hd = self.get(defender)?;
        if hd.kind != Kind::Vault {
            return Err(Error::NotVault);
        }
        if now > r.deadline {
            return Err(Error::WindowClosed);
        }
        let burn = bps(r.stake, self.p.raid_burn_bps);
        self.s.escrow -= r.stake;
        self.s.burned += burn;
        self.credit(defender, &mut hd, r.stake - burn);
        hd.under_raid = None;
        hd.immune_until = now + self.p.immunity_ms;
        r.status = RaidStatus::Defended;
        r.burned = burn;
        self.store.put_holder(defender, hd);
        self.store.put_raid(r.clone());
        Ok(r)
    }

    pub fn resolve(&mut self, raid_id: u64, now: u64) -> Res<Raid> {
        let mut r = self.store.raid(raid_id).ok_or(Error::RaidNotOpen)?;
        if r.status != RaidStatus::Open {
            return Err(Error::RaidNotOpen);
        }
        if now <= r.deadline {
            return Err(Error::WindowOpen);
        }
        let mut ht = self.get(&r.target)?;
        let mut ha = self.get(&r.attacker)?;
        let bal = self.s.balance(ht.kind, ht.shares);
        let frozen = ht.kind == Kind::Exposed && self.s.after_q_day(self.p, now);
        let take = if frozen {
            0
        } else {
            let shield = self.effective_shield(&ht, r.deadline);
            let raw = bps(bps(bal, self.p.take_bps), 10_000 - shield);
            raw.min(r.stake.saturating_mul(self.p.stake_mult as u128))
        };
        let burn = bps(take, self.p.raid_burn_bps);
        if take > 0 {
            self.debit(&mut ht, take)?;
        }
        self.s.escrow -= r.stake;
        self.s.burned += burn;
        self.credit(&r.attacker, &mut ha, r.stake + take - burn);
        ht.under_raid = None;
        ht.immune_until = now + self.p.immunity_ms;
        r.status = RaidStatus::Resolved;
        r.take = take;
        r.burned = burn;
        let target = r.target.clone();
        let attacker = r.attacker.clone();
        self.store.put_holder(&target, ht);
        self.store.put_holder(&attacker, ha);
        self.store.put_raid(r.clone());
        Ok(r)
    }

    // ---------------------------------------------------------------- boss

    pub fn boss_raid(&mut self, id: &str, now: u64) -> Res<BossOutcome> {
        if self.s.after_q_day(self.p, now) {
            return Err(Error::QDayPassed);
        }
        let mut h = self.get(id)?;
        if h.kind != Kind::Vault {
            return Err(Error::NotVault);
        }
        let epoch = self.s.epoch(self.p, now);
        if h.last_boss_epoch == epoch {
            return Err(Error::BossDone);
        }
        if self.s.balance(h.kind, h.shares) < self.p.boss_min_balance {
            return Err(Error::BossMinBalance);
        }
        let stash = self.s.satoshi_balance();
        let amt = bps(stash, self.p.boss_bps).min(self.p.boss_cap);
        if amt == 0 {
            return Err(Error::BossEmpty);
        }
        let sat_shares = self.s.satoshi_shares;
        let used = self.s.withdraw(Bucket::E, sat_shares, amt)?;
        self.s.satoshi_shares -= used;
        let burn = bps(amt, self.p.boss_burn_bps);
        self.s.burned += burn;
        self.credit(id, &mut h, amt - burn);
        h.last_boss_epoch = epoch;
        self.store.put_holder(id, h);
        Ok(BossOutcome { taken: amt, burned: burn, gained: amt - burn })
    }

    /// Shield in force for a holder right now.
    pub fn shield_now(&self, id: &str, now: u64) -> u32 {
        match self.store.holder(id) {
            Some(h) => self.effective_shield(&h, now),
            None => 0,
        }
    }
}
