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
    w.vault("att", 5);
    w.vault("tgt", 5);
    for i in 0..10 {
        w.g().register(&format!("e{i}"), Kind::Exposed).unwrap();
        w.g().buy(&format!("e{i}"), 2 * N, 0, 0).unwrap();
    }
    assert_eq!(w.h("att").bullets, a.clip_size);
    for i in 0..a.clip_size {
        w.g().raid("att", &format!("e{i}"), w.p.min_stake, 1_000).unwrap();
    }
    assert_eq!(w.g().raid("att", "e9", w.p.min_stake, 1_000), Err(Error::NoBullets));
    // one bullet comes back after bullet_regen_ms
    let t = 1_000 + a.bullet_regen_ms;
    w.g().raid("att", "e9", w.p.min_stake, t).unwrap();
    assert_eq!(w.g().raid("att", "e8", w.p.min_stake, t), Err(Error::TargetBusy));
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
    let id = w.g().raid("att", "tgt", w.p.min_stake, 10).unwrap();
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
fn boss_cooldown_death_respawn_and_round_end() {
    let mut w = World::new();
    let a = w.a();
    let names: Vec<String> = (0..8).map(|i| format!("v{i}")).collect();
    for n in &names {
        w.vault(n, 2);
    }
    w.g().boss_raid("v0", 1_000).unwrap();
    assert_eq!(w.g().boss_raid("v0", 1_000 + a.boss_cooldown_ms - 1), Err(Error::BossCooldown));
    // everyone hits until he dies; bullets regenerate with time
    let mut t = 1_000 + a.boss_cooldown_ms;
    let mut hits = 1u32;
    let mut end = None;
    'outer: for _ in 0..10_000 {
        for n in &names {
            let mut g = w.g();
            if let Some(r) = g.roll(t) {
                panic!("timed out before a kill: {r:?}");
            }
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
    let e = end.expect("Satoshi died");
    println!("killed after {hits} hits, {} s", t / 1000);
    assert_eq!(e.round, 0);
    assert!(e.killer.is_some());
    assert!(e.winner.is_some());
    assert!(e.respawn > 0);
    assert_eq!(w.s.round, 1);
    assert_eq!(w.s.round_start_ms, t);
    assert!(w.s.satoshi_balance() >= a.boss_life - 1);
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
