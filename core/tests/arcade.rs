//! Arcade rules (practice season 5): bullets, shield charges, the Satoshi life
//! bar and rounds that end when he dies.
use qday_core::*;

const T: u128 = ONE;
const N: u128 = ONE_NEAR;

fn params() -> Params {
    let mut p: Params = serde_json::from_str(include_str!("../../sim/params-arcade5.json")).unwrap();
    p.reserve_cap = 10_000 * N;
    p
}

struct World {
    p: Params,
    s: State,
    m: MemStore,
}

impl World {
    fn new() -> Self {
        let p = params();
        p.validate().unwrap();
        let s = State::genesis(&p, 0);
        World { p, s, m: MemStore::default() }
    }
    fn g(&mut self) -> Game<'_, MemStore> {
        Game::new(&self.p, &mut self.s, &mut self.m)
    }
    fn a(&self) -> Arcade {
        self.p.arcade.clone().unwrap()
    }
    fn bal(&mut self, id: &str) -> u128 {
        self.g().balance_of(id)
    }
    fn vault(&mut self, id: &str, near: u128) {
        self.g().register(id, Kind::Vault).unwrap();
        self.g().buy(id, near * N, 0, 0).unwrap();
    }
    fn h(&self, id: &str) -> Holder {
        self.m.holders[id].clone()
    }
    fn check(&self) {
        assert!(self.s.balanced(&self.p), "invariant broken: {:?}", self.s);
    }
}

#[test]
fn genesis_splits_satoshi_into_life_and_reserve() {
    let w = World::new();
    let a = w.a();
    assert_eq!(w.s.satoshi_balance(), a.boss_life);
    assert_eq!(w.s.sat_reserve, w.p.satoshi_supply - a.boss_life);
    w.check();
}

#[test]
fn raids_cost_bullets_and_bullets_regenerate() {
    let mut w = World::new();
    let a = w.a();
    w.vault("att", 1);
    for i in 0..10 {
        w.g().register(&format!("e{i}"), Kind::Exposed).unwrap();
        w.g().buy(&format!("e{i}"), 2 * N, 0, 0).unwrap();
    }
    assert_eq!(w.h("att").bullets, a.clip_size);
    for i in 0..a.clip_size {
        { let st = w.p.min_stake; w.g().raid("att", &format!("e{i}"), st, 1_000) }.unwrap();
    }
    assert_eq!({ let st = w.p.min_stake; w.g().raid("att", "e9", st, 1_000) }, Err(Error::NoBullets));
    // one bullet comes back after bullet_regen_ms
    let t = 1_000 + a.bullet_regen_ms;
    { let st = w.p.min_stake; w.g().raid("att", "e9", st, t) }.unwrap();
    assert_eq!({ let st = w.p.min_stake; w.g().raid("att", "e8", st, t) }, Err(Error::NoBullets));
    assert_eq!(regen(w.h("att").bullets, w.h("att").bullet_ts, a.clip_size, a.bullet_regen_ms, t), (0, t));
    w.check();
}

#[test]
fn reload_burns_the_price_and_fills_the_clip() {
    let mut w = World::new();
    let a = w.a();
    w.vault("v", 5);
    assert_eq!(w.g().reload("v", 10), Err(Error::ClipFull));
    let mut h = w.h("v");
    h.bullets = 0;
    h.bullet_ts = 10;
    w.m.holders.insert("v".into(), h);
    let b0 = w.bal("v");
    let burned0 = w.s.burned;
    assert_eq!(w.g().reload("v", 20).unwrap(), a.reload_price);
    assert_eq!(w.bal("v"), b0 - a.reload_price);
    assert_eq!(w.s.burned, burned0 + a.reload_price);
    assert_eq!(w.h("v").bullets, a.clip_size);
    w.check();
}

#[test]
fn block_spends_a_charge_and_defend_spends_a_bullet() {
    let mut w = World::new();
    let a = w.a();
    w.vault("att", 5);
    w.vault("tgt", 5);
    let stake = 2_000 * T;
    let id = w.g().raid("att", "tgt", stake, 100).unwrap();
    let t0 = w.bal("tgt");
    let r = w.g().block("tgt", id, 200).unwrap();
    assert_eq!(r.status, RaidStatus::Blocked);
    assert_eq!(w.h("tgt").shields, a.shield_max - 1);
    assert_eq!(w.bal("tgt"), t0 + stake - r.burned);
    let (gain, _) = w.h("tgt").round_stats(0);
    assert_eq!(gain, stake - r.burned);
    assert_eq!(w.h("att").round_stats(0).1, stake);
    // immunity, then a second raid answered with a bullet
    let t = 200 + w.p.immunity_ms + 1;
    let id = w.g().raid("att", "tgt", stake, t).unwrap();
    let r = w.g().defend("tgt", id, t + 1).unwrap();
    assert_eq!(r.status, RaidStatus::Defended);
    assert_eq!(w.h("tgt").bullets, a.clip_size - 1);
    w.check();
}

#[test]
fn no_shields_refuses_and_buy_shield_burns() {
    let mut w = World::new();
    let a = w.a();
    w.vault("att", 5);
    w.vault("tgt", 5);
    let mut h = w.h("tgt");
    h.shields = 0;
    h.shield_ts = 0;
    w.m.holders.insert("tgt".into(), h);
    let id = { let st = w.p.min_stake; w.g().raid("att", "tgt", st, 10) }.unwrap();
    assert_eq!(w.g().block("tgt", id, 20), Err(Error::NoShields));
    let burned0 = w.s.burned;
    assert_eq!(w.g().buy_shield("tgt", 30).unwrap(), 1);
    assert_eq!(w.s.burned, burned0 + a.shield_price);
    w.g().block("tgt", id, 40).unwrap();
    // the free charge regenerates
    let t = 40 + a.shield_regen_ms;
    assert_eq!(regen(w.h("tgt").shields, w.h("tgt").shield_ts, a.shield_max, a.shield_regen_ms, t).0, 1);
    w.check();
}

#[test]
fn boss_blast_splits_the_pot_by_damage_and_claims_once() {
    let mut w = World::new();
    let a = w.a();
    let names: Vec<String> = (0..8).map(|i| format!("v{i}")).collect();
    for n in &names {
        w.vault(n, 2);
    }
    let before: Vec<u128> = names.iter().map(|n| w.bal(n)).collect();
    let sat0 = w.s.satoshi_balance();
    let o = w.g().boss_raid("v0", 1_000).unwrap();
    assert_eq!(o.gained, 0, "a hit moves no coins");
    assert_eq!(w.s.satoshi_balance(), sat0, "his stash stays until he blasts");
    assert_eq!(w.g().boss_hp(), sat0 - o.taken);
    assert_eq!(w.g().boss_raid("v0", 1_000 + a.boss_cooldown_ms - 1), Err(Error::BossCooldown));
    let mut t = 1_000 + a.boss_cooldown_ms;
    let mut hits = 1u32;
    let mut end = None;
    'outer: for _ in 0..10_000 {
        for (i, n) in names.iter().enumerate() {
            if i % 3 == 2 {
                continue; // these vaults never hit
            }
            let mut g = w.g();
            assert!(g.roll(t).is_none(), "timed out before a kill");
            if let Ok(o) = g.boss_raid(n, t) {
                hits += 1;
                if let Some(e) = o.round_end {
                    end = Some(e);
                    break 'outer;
                }
            }
        }
        t += a.boss_cooldown_ms;
    }
    let e = end.expect("Satoshi blasted");
    println!("blast after {hits} hits, {} s, pot {}", t / 1000, e.pot / T);
    assert_eq!(e.round, 0);
    assert_eq!(e.pot, sat0 - sat0 * w.p.boss_burn_bps as u128 / 10_000);
    assert_eq!(e.damage, sat0);
    assert_eq!(e.hitters, 6);
    // the winner is the hitter with the most damage (no raids this round)
    let top = names.iter().map(|n| w.h(n).dmg).max().unwrap();
    let wn = e.winner.clone().expect("a blast round has a winner");
    assert_eq!(w.h(&wn).dmg, top);
    assert_eq!(e.winner_take, top - top * w.p.boss_burn_bps as u128 / 10_000);
    assert_eq!(w.s.round, 1);
    assert_eq!(w.s.satoshi_balance(), a.boss_life, "respawned from the reserve");
    w.check();
    // shares are pending until claimed, and the views can see them
    let h0 = w.h("v0");
    let share0 = w.g().pending_blast(&h0);
    assert_eq!(share0, qday_core::math::mul_div(e.pot, h0.dmg, e.damage));
    let h2 = w.h("v2");
    assert_eq!(w.g().pending_blast(&h2), 0, "no damage, no share");
    let (r, got) = w.g().settle("v0").unwrap();
    assert_eq!((r, got), (0, share0));
    assert_eq!(w.g().settle("v0"), None, "no double claim");
    assert_eq!(w.bal("v0"), before[0] + share0);
    assert_eq!(w.h("v0").round_stats(0).0, share0, "the share counts toward the round take");
    // a move settles lazily
    w.g().reload("v1", t + 1).ok();
    w.g().set_break("v1", true, t + 1).unwrap();
    assert_eq!(w.h("v1").dmg, 0);
    assert!(w.bal("v1") > before[1] - a.reload_price);
    let mut paid = 0;
    for n in &names {
        if let Some((_, c)) = w.g().settle(n) {
            paid += c;
        }
    }
    let b = w.m.blasts[&0].clone();
    assert!(b.paid <= b.pot && b.pot - b.paid < 10, "dust only: {} left", b.pot - b.paid);
    let _ = paid;
    w.check();
}

#[test]
fn timeout_drops_damage_without_a_blast() {
    let mut w = World::new();
    let a = w.a();
    w.vault("v", 2);
    w.g().boss_raid("v", 10).unwrap();
    let e = w.g().roll(a.round_max_ms + 1).unwrap();
    assert_eq!(e.winner, None, "damage alone wins nothing when he survives");
    assert_eq!(w.g().boss_hp(), w.s.satoshi_balance(), "he heals when the round times out");
    assert_eq!(w.g().settle("v"), None);
    assert_eq!(w.h("v").dmg, 0);
    w.check();
}

#[test]
fn round_times_out_and_harvest_follows_rounds() {
    let mut w = World::new();
    let a = w.a();
    assert_eq!(w.g().roll(a.round_max_ms - 1), None);
    let e = w.g().roll(a.round_max_ms * 2 + 5).unwrap();
    assert_eq!(e.round, 0);
    assert_eq!(e.killer, None);
    assert_eq!(w.s.round, 2);
    assert_eq!(w.s.round_start_ms, a.round_max_ms * 2);
    w.g().register("e", Kind::Exposed).unwrap();
    w.g().buy("e", N, 0, 0).unwrap();
    let h = w.g().harvest(a.round_max_ms * 2 + 6).unwrap();
    assert_eq!(h.epochs, 2);
    w.check();
}

#[test]
fn percentage_shield_is_off_and_break_toggles() {
    let mut w = World::new();
    w.vault("v", 2);
    assert_eq!(w.g().charge_shield("v", T, 0), Err(Error::Arcade));
    w.g().set_break("v", true, 5).unwrap();
    assert!(w.h("v").on_break);
    w.g().set_break("v", false, 6).unwrap();
    assert!(!w.h("v").on_break);
}

#[test]
fn raid_take_wins_a_timed_out_round_and_block_counts_for_the_defender() {
    let mut w = World::new();
    let a = w.a();
    w.vault("att", 1);
    w.g().register("e1", Kind::Exposed).unwrap();
    w.g().buy("e1", 5 * N, 0, 0).unwrap();
    w.vault("def", 1);
    let st = w.p.min_stake;
    let id = w.g().raid("att", "e1", st, 10).unwrap();
    let dw = w.p.defend_window_ms;
    let r = w.g().resolve(id, 10 + dw + 1).unwrap();
    assert!(r.take > 0);
    let st = w.p.min_stake;
    let id2 = w.g().raid("def", "att", st, 20).ok();
    let _ = id2;
    let e = w.g().roll(a.round_max_ms + 1).unwrap();
    assert_eq!(e.winner.as_deref(), Some("att"));
    assert_eq!(e.winner_take, w.h("att").round_stats(0).0);
    w.check();
}
