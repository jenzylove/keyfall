//! The Q-DAY rules. Pure: no chain code, time is passed in, storage is a trait.
//! The contract and the simulation both call these functions.

use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};

use crate::math::{bps, div_ceil_256, isqrt, mul_div, mul_div_ceil, U256};
use crate::params::{u128_str, Arcade, Params};

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

    // Arcade (season 5 practice). Counts regenerate lazily from the anchors.
    /// Bullets at `bullet_ts`; one more every `bullet_regen_ms`, up to the clip.
    pub bullets: u32,
    pub bullet_ts: u64,
    /// Shield charges at `shield_ts`; one more every `shield_regen_ms`, up to the max.
    pub shields: u32,
    pub shield_ts: u64,
    /// Time of the last Satoshi hit (0 = never).
    pub last_boss_ms: u64,
    /// Taking a break: the game's bots leave this vault alone (players still may not).
    pub on_break: bool,
    pub break_since: u64,
    /// Coins won and lost in round `stat_round`, and in the round before it.
    pub stat_round: u64,
    #[serde(with = "u128_str")]
    pub gain: u128,
    #[serde(with = "u128_str")]
    pub loss: u128,
    pub prev_round: u64,
    #[serde(with = "u128_str")]
    pub prev_gain: u128,
    #[serde(with = "u128_str")]
    pub prev_loss: u128,
    /// Damage dealt to Satoshi in round `dmg_round`, not yet settled. When that
    /// round ends in a blast, the vault's share of the pot is credited on its
    /// next move or by `claim_blast`.
    pub dmg_round: u64,
    #[serde(with = "u128_str")]
    pub dmg: u128,
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
            bullets: 0,
            bullet_ts: 0,
            shields: 0,
            shield_ts: 0,
            last_boss_ms: 0,
            on_break: false,
            break_since: 0,
            stat_round: 0,
            gain: 0,
            loss: 0,
            prev_round: u64::MAX,
            prev_gain: 0,
            prev_loss: 0,
            dmg_round: 0,
            dmg: 0,
        }
    }

    /// Coins (won, lost) in `round`, if this holder kept a record of it.
    pub fn round_stats(&self, round: u64) -> (u128, u128) {
        if self.stat_round == round {
            (self.gain, self.loss)
        } else if self.prev_round == round {
            (self.prev_gain, self.prev_loss)
        } else {
            (0, 0)
        }
    }
}

/// Lazy regeneration: `count` at anchor `ts`, one more every `period`, up to
/// `max`. Returns the count now and the new anchor (now, when full).
pub fn regen(count: u32, ts: u64, max: u32, period: u64, now: u64) -> (u32, u64) {
    if count >= max {
        return (max, now);
    }
    let k = now.saturating_sub(ts) / period;
    let n = (count as u64).saturating_add(k);
    if n >= max as u64 {
        (max, now)
    } else {
        (n as u32, ts + k * period)
    }
}

/// When the next free unit arrives (0 when already full).
pub fn regen_next(count: u32, ts: u64, max: u32, period: u64, now: u64) -> u64 {
    let (n, t) = regen(count, ts, max, period, now);
    if n >= max {
        0
    } else {
        t + period
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
#[serde(rename_all = "lowercase")]
pub enum RaidStatus {
    Open,
    Defended,
    Resolved,
    /// Arcade: the target spent a shield charge; the raid failed.
    Blocked,
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

    // Arcade. Unused (zero) on older seasons.
    /// Current round (the arcade epoch) and when it started.
    pub round: u64,
    pub round_start_ms: u64,
    /// `burned` when the round started, for the round's burn total.
    #[serde(with = "u128_str")]
    pub round_burn_start: u128,
    /// Satoshi's reserve: the part of his supply not yet in his life bar.
    /// Each respawn refills his stash from here; it never grows.
    #[serde(with = "u128_str")]
    pub sat_reserve: u128,
    pub kills: u64,
    /// Damage dealt to Satoshi this round and how many vaults dealt it.
    #[serde(with = "u128_str")]
    pub round_damage: u128,
    pub round_hitters: u64,
    /// Blast pots not yet claimed by the vaults that earned them.
    #[serde(with = "u128_str")]
    pub blast_escrow: u128,
    /// Satoshi's life at his last spawn; a hit deals `boss_bps` of it.
    #[serde(with = "u128_str")]
    pub boss_spawn: u128,
}

/// The pot of one Satoshi blast, shared by damage among the round's hitters.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct Blast {
    pub round: u64,
    #[serde(with = "u128_str")]
    pub pot: u128,
    #[serde(with = "u128_str")]
    pub damage: u128,
    pub hitters: u64,
    /// Coins already credited to hitters.
    #[serde(with = "u128_str")]
    pub paid: u128,
}

/// One finished arcade round.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct RoundEnd {
    pub round: u64,
    /// The vault whose hit killed Satoshi; None when the round timed out.
    pub killer: Option<String>,
    /// Satoshi's blast: the pot shared by damage, the damage dealt and by how many vaults.
    #[serde(with = "u128_str")]
    pub pot: u128,
    #[serde(with = "u128_str")]
    pub damage: u128,
    pub hitters: u64,
    /// Coins burned during the round.
    #[serde(with = "u128_str")]
    pub burned: u128,
    pub started_ms: u64,
    pub ended_ms: u64,
    /// Coins put into his new life bar (reserve first, then this round's burns).
    #[serde(with = "u128_str")]
    pub respawn: u128,
    /// The part of `respawn` that came back from this round's burns.
    #[serde(with = "u128_str")]
    pub recycled: u128,
    /// His stash when the next round starts.
    #[serde(with = "u128_str")]
    pub boss_hp: u128,
}

pub trait Store {
    fn holder(&self, id: &str) -> Option<Holder>;
    fn put_holder(&mut self, id: &str, h: Holder);
    fn raid(&self, id: u64) -> Option<Raid>;
    fn put_raid(&mut self, r: Raid);
    fn blast(&self, round: u64) -> Option<Blast>;
    fn put_blast(&mut self, b: Blast);
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
    PunchDown,
    StakeTooSmall,
    RaidLimit,
    RaidNotOpen,
    NotTarget,
    WindowClosed,
    WindowOpen,
    BossDone,
    BossMinBalance,
    BossEmpty,
    NoBullets,
    NoShields,
    ClipFull,
    ShieldsFull,
    BossCooldown,
    NotArcade,
    Arcade,
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
            Error::PunchDown => "E_PUNCH_DOWN: target is too small next to you",
            Error::StakeTooSmall => "E_STAKE_TOO_SMALL",
            Error::RaidLimit => "E_RAID_LIMIT: no raids left this epoch",
            Error::RaidNotOpen => "E_RAID_NOT_OPEN",
            Error::NotTarget => "E_NOT_TARGET: only the target can defend",
            Error::WindowClosed => "E_WINDOW_CLOSED: the defend window has ended",
            Error::WindowOpen => "E_WINDOW_OPEN: the defend window is still open",
            Error::BossDone => "E_BOSS_DONE: already hit Satoshi this epoch",
            Error::BossMinBalance => "E_BOSS_MIN_BALANCE: vault balance too low to hit Satoshi",
            Error::BossEmpty => "E_BOSS_EMPTY: Satoshi has nothing left",
            Error::NoBullets => "E_NO_BULLETS: the clip is empty; reload or wait for a free bullet",
            Error::NoShields => "E_NO_SHIELDS: no shield charges left; buy one or shoot back",
            Error::ClipFull => "E_CLIP_FULL: the clip is already full",
            Error::ShieldsFull => "E_SHIELDS_FULL: shield charges are already full",
            Error::BossCooldown => "E_BOSS_COOLDOWN: wait for your next shot at Satoshi",
            Error::NotArcade => "E_NOT_ARCADE: this season has no bullets or shield charges",
            Error::Arcade => "E_ARCADE: shields are charges this season; use buy_shield",
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
    /// Arcade: set when this hit killed Satoshi and ended the round.
    pub round_end: Option<RoundEnd>,
}

pub struct Game<'a, S: Store> {
    pub p: &'a Params,
    pub s: &'a mut State,
    pub store: &'a mut S,
}

impl State {
    pub fn genesis(p: &Params, start_ms: u64) -> State {
        // Arcade: Satoshi spawns with `boss_life`; the rest of his supply waits in his reserve.
        let life = p.arcade.as_ref().map(|a| a.boss_life.min(p.satoshi_supply)).unwrap_or(p.satoshi_supply);
        State {
            start_ms,
            e_tokens: life,
            e_shares: life,
            q_tokens: 0,
            q_shares: 0,
            satoshi_shares: life,
            sold: 0,
            near_reserve: 0,
            escrow: 0,
            burned: 0,
            harvested: 0,
            next_raid_id: 1,
            vaults: 0,
            exposed_holders: 0,
            round: 0,
            round_start_ms: start_ms,
            round_burn_start: 0,
            sat_reserve: p.satoshi_supply - life,
            kills: 0,
            round_damage: 0,
            round_hitters: 0,
            blast_escrow: 0,
            boss_spawn: life,
        }
    }

    /// The epoch. On arcade seasons this is the round: it moves on when
    /// Satoshi dies, or `round_max_ms` after the round started.
    pub fn epoch(&self, p: &Params, now: u64) -> u64 {
        match &p.arcade {
            None => now.saturating_sub(self.start_ms) / p.epoch_ms,
            Some(a) => self.round + now.saturating_sub(self.round_start_ms) / a.round_max_ms,
        }
    }

    /// The round a blast for `dmg_round` must be older than (same as `epoch`).
    pub fn round_now(&self, p: &Params, now: u64) -> u64 {
        self.epoch(p, now)
    }

    /// When the current epoch (round) started and when it ends at the latest.
    pub fn epoch_bounds(&self, p: &Params, now: u64) -> (u64, u64) {
        match &p.arcade {
            None => {
                let e = self.epoch(p, now);
                (self.start_ms + e * p.epoch_ms, self.start_ms + (e + 1) * p.epoch_ms)
            }
            Some(a) => {
                let skipped = now.saturating_sub(self.round_start_ms) / a.round_max_ms;
                let start = self.round_start_ms + skipped * a.round_max_ms;
                (start, start + a.round_max_ms)
            }
        }
    }

    /// Harvests due in total by `now` (one per epoch until Q-Day).
    pub fn harvest_due_total(&self, p: &Params, now: u64) -> u64 {
        match &p.arcade {
            None => self.epoch(p, now).min(p.season_epochs),
            Some(_) => self.epoch(p, now.min(self.q_day_ms(p))),
        }
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
        self.e_tokens + self.q_tokens + self.curve_left(p) + self.escrow + self.burned + self.sat_reserve + self.blast_escrow
            == p.total_supply
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
        let mut h = Holder::new(kind);
        if let (Some(a), Kind::Vault) = (&self.p.arcade, kind) {
            h.bullets = a.clip_size;
            h.shields = a.shield_max;
        }
        self.store.put_holder(id, h);
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
        let due_total = self.s.harvest_due_total(self.p, now);
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
        self.settle(from);
        self.settle(to);
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
        self.settle(buyer);
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
        self.settle(seller);
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
        if self.p.arcade.is_some() {
            return Err(Error::Arcade);
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
        self.settle(attacker);
        self.settle(target);
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
        let tbal = self.s.balance(ht.kind, ht.shares);
        if tbal < self.p.min_target_balance {
            return Err(Error::TargetTooSmall);
        }
        let abal = self.s.balance(ha.kind, ha.shares);
        if tbal.saturating_mul(self.p.punch_down_band as u128) < abal {
            return Err(Error::PunchDown);
        }
        let p = self.p;
        if let Some(a) = &p.arcade {
            // A raid is a shot: it costs one bullet.
            let (n, ts) = regen(ha.bullets, ha.bullet_ts, a.clip_size, a.bullet_regen_ms, now);
            if n == 0 {
                return Err(Error::NoBullets);
            }
            self.debit(&mut ha, stake)?;
            ha.bullets = n - 1;
            ha.bullet_ts = ts;
        } else {
            let epoch = self.s.epoch(self.p, now);
            if ha.raid_epoch != epoch {
                ha.raid_epoch = epoch;
                ha.raids_in_epoch = 0;
            }
            if ha.raids_in_epoch >= self.p.max_raids_per_epoch {
                return Err(Error::RaidLimit);
            }
            self.debit(&mut ha, stake)?;
            ha.raids_in_epoch += 1;
        }
        self.s.escrow += stake;

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

    /// Shoot back. On arcade seasons it costs one bullet.
    pub fn defend(&mut self, defender: &str, raid_id: u64, now: u64) -> Res<Raid> {
        self.answer(defender, raid_id, now, false)
    }

    /// Arcade: spend one shield charge; the raid fails like a defended one
    /// (the stake, less the burn, goes to the target).
    pub fn block(&mut self, defender: &str, raid_id: u64, now: u64) -> Res<Raid> {
        if self.p.arcade.is_none() {
            return Err(Error::NotArcade);
        }
        self.answer(defender, raid_id, now, true)
    }

    fn answer(&mut self, defender: &str, raid_id: u64, now: u64, block: bool) -> Res<Raid> {
        let mut r = self.store.raid(raid_id).ok_or(Error::RaidNotOpen)?;
        if r.status != RaidStatus::Open {
            return Err(Error::RaidNotOpen);
        }
        if r.target != defender {
            return Err(Error::NotTarget);
        }
        self.settle(defender);
        let mut hd = self.get(defender)?;
        if hd.kind != Kind::Vault {
            return Err(Error::NotVault);
        }
        if now > r.deadline {
            return Err(Error::WindowClosed);
        }
        let p = self.p;
        if let Some(a) = &p.arcade {
            if block {
                let (n, ts) = regen(hd.shields, hd.shield_ts, a.shield_max, a.shield_regen_ms, now);
                if n == 0 {
                    return Err(Error::NoShields);
                }
                hd.shields = n - 1;
                hd.shield_ts = ts;
            } else {
                let (n, ts) = regen(hd.bullets, hd.bullet_ts, a.clip_size, a.bullet_regen_ms, now);
                if n == 0 {
                    return Err(Error::NoBullets);
                }
                hd.bullets = n - 1;
                hd.bullet_ts = ts;
            }
        }
        let burn = bps(r.stake, self.p.raid_burn_bps);
        self.s.escrow -= r.stake;
        self.s.burned += burn;
        self.credit(defender, &mut hd, r.stake - burn);
        self.note(defender, &mut hd, now, r.stake - burn, 0);
        hd.under_raid = None;
        hd.immune_until = now + self.p.immunity_ms;
        r.status = if block { RaidStatus::Blocked } else { RaidStatus::Defended };
        r.burned = burn;
        if self.p.arcade.is_some() {
            let attacker = r.attacker.clone();
            if let Some(mut ha) = self.store.holder(&attacker) {
                self.note(&attacker, &mut ha, now, 0, r.stake);
                self.store.put_holder(&attacker, ha);
            }
        }
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
        self.settle(&r.target);
        self.settle(&r.attacker);
        let mut ht = self.get(&r.target)?;
        let mut ha = self.get(&r.attacker)?;
        let bal = self.s.balance(ht.kind, ht.shares);
        let frozen = ht.kind == Kind::Exposed && self.s.after_q_day(self.p, now);
        let take = if frozen {
            0
        } else {
            let shield = self.effective_shield(&ht, r.deadline);
            let share = if ht.kind == Kind::Vault { self.p.vault_take_bps } else { self.p.take_bps };
            let raw = bps(bps(bal, share), 10_000 - shield);
            raw.min(r.stake.saturating_mul(self.p.stake_mult as u128))
        };
        let burn = bps(take, self.p.raid_burn_bps);
        if take > 0 {
            self.debit(&mut ht, take)?;
        }
        self.s.escrow -= r.stake;
        self.s.burned += burn;
        self.credit(&r.attacker, &mut ha, r.stake + take - burn);
        let (att, tgt) = (r.attacker.clone(), r.target.clone());
        self.note(&att, &mut ha, now, take - burn, 0);
        self.note(&tgt, &mut ht, now, 0, take);
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
        let p = self.p;
        if let Some(a) = &p.arcade {
            self.settle(id);
            h = self.get(id)?;
            return self.boss_hit(a, id, h, now);
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
        Ok(BossOutcome { taken: amt, burned: burn, gained: amt - burn, round_end: None })
    }

    // ---------------------------------------------------------------- arcade

    /// Record coins won or lost in the current round, and the round's top taker.
    fn note(&mut self, id: &str, h: &mut Holder, now: u64, gain: u128, loss: u128) {
        if self.p.arcade.is_none() {
            return;
        }
        let r = self.s.epoch(self.p, now);
        if h.stat_round != r {
            h.prev_round = h.stat_round;
            h.prev_gain = h.gain;
            h.prev_loss = h.loss;
            h.stat_round = r;
            h.gain = 0;
            h.loss = 0;
        }
        h.gain += gain;
        h.loss += loss;
        let _ = id;
    }

    fn start_round(&mut self, round: u64, at: u64) {
        self.s.round = round;
        self.s.round_start_ms = at;
        self.s.round_burn_start = self.s.burned;
        self.s.round_damage = 0;
        self.s.round_hitters = 0;
    }

    /// Arcade: end a round that ran out of time. Call before any move; returns
    /// the finished round when one ended since the last call.
    pub fn roll(&mut self, now: u64) -> Option<RoundEnd> {
        let a = self.p.arcade.as_ref()?;
        let cur = self.s.epoch(self.p, now);
        if cur <= self.s.round {
            return None;
        }
        let started = self.s.round_start_ms;
        let end = RoundEnd {
            round: self.s.round,
            killer: None,
            pot: 0,
            damage: self.s.round_damage,
            hitters: self.s.round_hitters,
            burned: self.s.burned - self.s.round_burn_start,
            started_ms: started,
            ended_ms: started + a.round_max_ms,
            respawn: 0,
            recycled: 0,
            boss_hp: self.s.satoshi_balance(),
        };
        let at = started + (cur - self.s.round) * a.round_max_ms;
        self.start_round(cur, at);
        Some(end)
    }

    /// Satoshi's life left this round.
    pub fn boss_hp(&self) -> u128 {
        self.s.satoshi_balance().saturating_sub(self.s.round_damage)
    }

    /// Arcade hit: one bullet, records damage only. No coins move until he
    /// blasts; then the pot is shared by damage (see `settle`).
    fn boss_hit(&mut self, a: &Arcade, id: &str, mut h: Holder, now: u64) -> Res<BossOutcome> {
        let hp = self.boss_hp();
        if hp == 0 {
            return Err(Error::BossEmpty);
        }
        if h.last_boss_ms != 0 && now < h.last_boss_ms + a.boss_cooldown_ms {
            return Err(Error::BossCooldown);
        }
        let (n, ts) = regen(h.bullets, h.bullet_ts, a.clip_size, a.bullet_regen_ms, now);
        if n == 0 {
            return Err(Error::NoBullets);
        }
        if self.s.balance(h.kind, h.shares) < self.p.boss_min_balance {
            return Err(Error::BossMinBalance);
        }
        let dmg = bps(self.s.boss_spawn, self.p.boss_bps).max(1).min(hp);
        let round = self.s.round;
        if h.dmg_round != round || h.dmg == 0 {
            h.dmg_round = round;
            h.dmg = 0;
            self.s.round_hitters += 1;
        }
        h.dmg += dmg;
        self.s.round_damage += dmg;
        h.bullets = n - 1;
        h.bullet_ts = ts;
        h.last_boss_ms = now;
        self.store.put_holder(id, h);

        let mut round_end = None;
        let mut burned = 0;
        if self.boss_hp() == 0 {
            // Satoshi blasts: his whole stash leaves him. The boss burn share
            // burns; the rest is the pot, held until each hitter claims.
            let stash = self.s.satoshi_balance();
            let sat_shares = self.s.satoshi_shares;
            let used = self.s.withdraw(Bucket::E, sat_shares, stash)?;
            self.s.satoshi_shares -= used;
            burned = bps(stash, self.p.boss_burn_bps);
            let pot = stash - burned;
            self.s.burned += burned;
            self.s.blast_escrow += pot;
            self.store.put_blast(Blast { round, pot, damage: self.s.round_damage, hitters: self.s.round_hitters, paid: 0 });
            // He respawns from his reserve. Once the reserve is spent he is
            // rebuilt from the coins this round burned (never more than that,
            // so the 21M cap holds and nothing is minted).
            let from_reserve = a.boss_life.min(self.s.sat_reserve);
            self.s.sat_reserve -= from_reserve;
            let round_burned = self.s.burned - self.s.round_burn_start;
            let from_burns = (a.boss_life - from_reserve).min(round_burned);
            self.s.burned -= from_burns;
            let add = from_reserve + from_burns;
            if add > 0 {
                let minted = self.s.deposit(Bucket::E, add);
                self.s.satoshi_shares += minted;
            }
            self.s.boss_spawn = self.s.satoshi_balance();
            let end = RoundEnd {
                round,
                killer: Some(id.to_string()),
                pot,
                damage: self.s.round_damage,
                hitters: self.s.round_hitters,
                burned: round_burned,
                started_ms: self.s.round_start_ms,
                ended_ms: now,
                respawn: add,
                recycled: from_burns,
                boss_hp: self.s.satoshi_balance(),
            };
            self.s.kills += 1;
            self.start_round(round + 1, now);
            round_end = Some(end);
        }
        Ok(BossOutcome { taken: dmg, burned, gained: 0, round_end })
    }

    /// Blast coins `h` has earned and not claimed yet (0 if none).
    pub fn pending_blast(&self, h: &Holder) -> u128 {
        if h.dmg == 0 || self.p.arcade.is_none() {
            return 0;
        }
        match self.store.blast(h.dmg_round) {
            Some(b) if b.damage > 0 => mul_div(b.pot, h.dmg, b.damage),
            _ => 0,
        }
    }

    /// Credit a vault's share of a finished blast. Lazy: called at the start
    /// of every move that touches the vault, and by `claim_blast`. A damage
    /// record from a round that timed out (no blast) is dropped. Returns
    /// (round, coins) when coins were credited.
    pub fn settle(&mut self, id: &str) -> Option<(u64, u128)> {
        self.p.arcade.as_ref()?;
        let mut h = self.store.holder(id)?;
        if h.dmg == 0 || h.dmg_round >= self.s.round {
            return None;
        }
        let round = h.dmg_round;
        let share = self.pending_blast(&h);
        h.dmg = 0;
        let mut out = None;
        if share > 0 {
            if let Some(mut b) = self.store.blast(round) {
                let share = share.min(b.pot - b.paid).min(self.s.blast_escrow);
                b.paid += share;
                self.store.put_blast(b);
                self.s.blast_escrow -= share;
                self.credit(id, &mut h, share);
                if h.stat_round == round {
                    h.gain += share;
                } else if h.prev_round == round {
                    h.prev_gain += share;
                }
                out = Some((round, share));
            }
        }
        self.store.put_holder(id, h);
        out
    }

    fn arcade_vault(&self, id: &str, now: u64) -> Res<(&'a Arcade, Holder)> {
        let p: &'a Params = self.p;
        let a = p.arcade.as_ref().ok_or(Error::NotArcade)?;
        if self.s.after_q_day(self.p, now) {
            return Err(Error::QDayPassed);
        }
        let h = self.get(id)?;
        if h.kind != Kind::Vault {
            return Err(Error::NotVault);
        }
        Ok((a, h))
    }

    /// Burn `reload_price` coins to fill the clip.
    pub fn reload(&mut self, id: &str, now: u64) -> Res<u128> {
        self.settle(id);
        let (a, mut h) = self.arcade_vault(id, now)?;
        let (n, _) = regen(h.bullets, h.bullet_ts, a.clip_size, a.bullet_regen_ms, now);
        if n >= a.clip_size {
            return Err(Error::ClipFull);
        }
        self.debit(&mut h, a.reload_price)?;
        self.s.burned += a.reload_price;
        self.note(id, &mut h, now, 0, a.reload_price);
        h.bullets = a.clip_size;
        h.bullet_ts = now;
        self.store.put_holder(id, h);
        Ok(a.reload_price)
    }

    /// Burn `shield_price` coins for one shield charge.
    pub fn buy_shield(&mut self, id: &str, now: u64) -> Res<u32> {
        self.settle(id);
        let (a, mut h) = self.arcade_vault(id, now)?;
        let (n, ts) = regen(h.shields, h.shield_ts, a.shield_max, a.shield_regen_ms, now);
        if n >= a.shield_max {
            return Err(Error::ShieldsFull);
        }
        self.debit(&mut h, a.shield_price)?;
        self.s.burned += a.shield_price;
        self.note(id, &mut h, now, 0, a.shield_price);
        h.shields = n + 1;
        h.shield_ts = if n + 1 >= a.shield_max { now } else { ts };
        self.store.put_holder(id, h);
        Ok(n + 1)
    }

    /// Take a break (the game's bots leave the vault alone) or come back.
    pub fn set_break(&mut self, id: &str, on: bool, now: u64) -> Res<()> {
        if self.p.arcade.is_none() {
            return Err(Error::NotArcade);
        }
        self.settle(id);
        let mut h = self.get(id)?;
        if h.kind != Kind::Vault {
            return Err(Error::NotVault);
        }
        h.on_break = on;
        h.break_since = if on { now } else { 0 };
        self.store.put_holder(id, h);
        Ok(())
    }

    /// Shield in force for a holder right now.
    pub fn shield_now(&self, id: &str, now: u64) -> u32 {
        match self.store.holder(id) {
            Some(h) => self.effective_shield(&h, now),
            None => 0,
        }
    }
}
