use borsh::{BorshDeserialize, BorshSerialize};
use serde::{Deserialize, Serialize};

/// u128 values travel as decimal strings in JSON so nothing loses precision.
pub mod u128_str {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &u128, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u128, D::Error> {
        let s = String::deserialize(d)?;
        s.parse::<u128>().map_err(serde::de::Error::custom)
    }
}

pub const DECIMALS: u8 = 18;
pub const ONE: u128 = 1_000_000_000_000_000_000; // 1 $QDAY
pub const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

/// Every rule number of a season. Fixed at init; readable through `config()`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct Params {
    /// Total supply in base units.
    #[serde(with = "u128_str")]
    pub total_supply: u128,
    /// Satoshi's stash in base units (exposed, can never move).
    #[serde(with = "u128_str")]
    pub satoshi_supply: u128,

    /// Bonding curve virtual NEAR reserve (yocto).
    #[serde(with = "u128_str")]
    pub curve_virtual_near: u128,
    /// Bonding curve virtual token reserve (base units). Must exceed the
    /// tokens for sale so the price stays finite.
    #[serde(with = "u128_str")]
    pub curve_virtual_tokens: u128,
    /// Hard cap on real NEAR held by the curve (yocto).
    #[serde(with = "u128_str")]
    pub reserve_cap: u128,
    /// Fee on sells, in tokens: half burned, half to vaults.
    pub sell_fee_bps: u32,

    /// Epoch length in milliseconds.
    pub epoch_ms: u64,
    /// Number of epochs until Q-Day.
    pub season_epochs: u64,

    /// Share of every exposed balance taken each epoch.
    pub harvest_bps: u32,

    /// Smallest raid stake.
    #[serde(with = "u128_str")]
    pub min_stake: u128,
    /// Smallest target balance that can be raided.
    #[serde(with = "u128_str")]
    pub min_target_balance: u128,
    /// Share of an exposed target's balance a successful raid takes.
    pub take_bps: u32,
    /// Share of a vault target's balance a successful raid takes (before shield).
    /// Lower than `take_bps`: a vault is armour.
    pub vault_take_bps: u32,
    /// No punching down: a raid needs `target balance * band >= attacker balance`.
    pub punch_down_band: u32,
    /// A raid never takes more than this many times its stake.
    pub stake_mult: u32,
    /// Share of a raid's take (or a defended stake) that burns.
    pub raid_burn_bps: u32,
    /// Defend window in milliseconds.
    pub defend_window_ms: u64,
    /// Immunity after a raid ends, in milliseconds.
    pub immunity_ms: u64,
    /// Raids a vault can open per epoch.
    pub max_raids_per_epoch: u32,

    /// Strongest possible shield.
    pub max_shield_bps: u32,

    /// Share of Satoshi's stash one boss raid takes.
    pub boss_bps: u32,
    /// Most a single boss raid can take.
    #[serde(with = "u128_str")]
    pub boss_cap: u128,
    /// Share of a boss raid that burns.
    pub boss_burn_bps: u32,
    /// A vault needs at least this balance to hit the boss.
    #[serde(with = "u128_str")]
    pub boss_min_balance: u128,

    /// Arcade rules (practice seasons from season 5): bullets, shield charges,
    /// a Satoshi life bar and rounds that end when he dies. Absent on older
    /// seasons and on mainnet, which keep raids per epoch and burned shields.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arcade: Option<Arcade>,
}

/// Arcade rule numbers. Every one of them is readable through `config()`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
pub struct Arcade {
    /// Bullets a vault holds at most. One raid, one defend or one Satoshi hit costs one.
    pub clip_size: u32,
    /// One free bullet comes back every this many ms, up to the clip.
    pub bullet_regen_ms: u64,
    /// `reload()` burns this many coins and fills the clip.
    #[serde(with = "u128_str")]
    pub reload_price: u128,
    /// Shield charges a vault holds at most. `block()` spends one.
    pub shield_max: u32,
    /// One free shield charge comes back every this many ms, up to the max.
    pub shield_regen_ms: u64,
    /// `buy_shield()` burns this many coins for one charge.
    #[serde(with = "u128_str")]
    pub shield_price: u128,
    /// A vault may hit Satoshi once per this many ms.
    pub boss_cooldown_ms: u64,
    /// Satoshi's stash at each spawn (his life bar), refilled from his reserve.
    /// A hit deals `boss_bps` of it as damage; at zero life he blasts and his
    /// stash, less `boss_burn_bps`, is shared by damage among the round's hitters.
    #[serde(with = "u128_str")]
    pub boss_life: u128,
    /// A round with no kill ends after this many ms.
    pub round_max_ms: u64,
}

impl Params {
    pub fn curve_supply(&self) -> u128 {
        self.total_supply - self.satoshi_supply
    }

    pub fn validate(&self) -> Result<(), &'static str> {
        if self.satoshi_supply >= self.total_supply {
            return Err("satoshi_supply must be below total_supply");
        }
        if self.curve_virtual_tokens <= self.curve_supply() {
            return Err("curve_virtual_tokens must exceed the tokens for sale");
        }
        if self.curve_virtual_near == 0 || self.epoch_ms == 0 || self.season_epochs == 0 {
            return Err("zero curve, epoch or season");
        }
        for b in [
            self.sell_fee_bps,
            self.harvest_bps,
            self.take_bps,
            self.vault_take_bps,
            self.raid_burn_bps,
            self.max_shield_bps,
            self.boss_bps,
            self.boss_burn_bps,
        ] {
            if b >= 10_000 {
                return Err("every bps value must be below 10000");
            }
        }
        if self.stake_mult == 0 || self.max_raids_per_epoch == 0 || self.punch_down_band == 0 {
            return Err("stake_mult, max_raids_per_epoch and punch_down_band must be positive");
        }
        if let Some(a) = &self.arcade {
            if a.clip_size == 0 || a.bullet_regen_ms == 0 || a.shield_max == 0 || a.shield_regen_ms == 0 || a.round_max_ms == 0 {
                return Err("arcade clip, shields, regen times and round length must be positive");
            }
            if a.boss_life == 0 || a.boss_life > self.satoshi_supply || self.boss_bps == 0 {
                return Err("arcade boss_life and boss_bps must be positive, boss_life within satoshi_supply");
            }
        }
        Ok(())
    }
}
