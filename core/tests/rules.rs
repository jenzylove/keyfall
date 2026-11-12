use qday_core::*;

const T: u128 = ONE; // one token
const N: u128 = ONE_NEAR; // one NEAR
const EPOCH: u64 = 3_600_000;

fn params() -> Params {
    Params {
        total_supply: 21_000_000 * T,
        satoshi_supply: 1_100_000 * T,
        curve_virtual_near: 30 * N,
        curve_virtual_tokens: 26_000_000 * T,
        reserve_cap: 1_000 * N,
        sell_fee_bps: 200,
        epoch_ms: EPOCH,
        season_epochs: 24,
        harvest_bps: 500,
        min_stake: 100 * T,
        min_target_balance: 1_000 * T,
        take_bps: 1_000,
        vault_take_bps: 1_000,
        punch_down_band: 1_000_000,
        stake_mult: 5,
        raid_burn_bps: 1_000,
        defend_window_ms: 600_000,
        immunity_ms: 3_600_000,
        max_raids_per_epoch: 3,
        max_shield_bps: 6_000,
        boss_bps: 50,
        boss_cap: 10_000 * T,
        boss_burn_bps: 2_000,
        boss_min_balance: 1_000 * T,
        arcade: None,
    }
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
    fn bal(&mut self, id: &str) -> u128 {
        self.g().balance_of(id)
    }
    fn check(&self) {
        assert!(self.s.balanced(&self.p), "invariant broken: {:?}", self.s);
    }
}

#[test]
fn genesis_is_balanced() {
    let w = World::new();
    w.check();
    assert_eq!(w.s.satoshi_balance(), 1_100_000 * T);
    assert_eq!(w.s.curve_left(&w.p), 19_900_000 * T);
}

#[test]
fn buy_then_sell_round_trip_loses_only_fee_and_curve() {
    let mut w = World::new();
    w.g().register("alice", Kind::Exposed).unwrap();
    let b = w.g().buy("alice", 10 * N, 0, 0).unwrap();
    assert!(b.tokens > 0);
    assert_eq!(w.bal("alice"), b.tokens);
    w.check();
    let s = w.g().sell("alice", b.tokens, 0, 0).unwrap();
    assert!(s.near < 10 * N, "can never get back more than paid");
    assert!(s.near > 9 * N, "only the fee and rounding are lost");
    assert_eq!(w.bal("alice"), 0);
    w.check();
}

#[test]
fn price_rises_with_buys() {
    let mut w = World::new();
    w.g().register("a", Kind::Exposed).unwrap();
    let p0 = spot_price(&w.p, &w.s);
    w.g().buy("a", 50 * N, 0, 0).unwrap();
    assert!(spot_price(&w.p, &w.s) > p0);
}

#[test]
fn reserve_cap_and_curve_full_are_enforced() {
    let mut w = World::new();
    w.g().register("a", Kind::Exposed).unwrap();
    assert_eq!(w.g().buy("a", 1_001 * N, 0, 0), Err(Error::ReserveCap));
    // Satoshi's tokens can't be dumped on the curve beyond what it sold.
    let q = quote_sell(&w.p, &w.s, 1);
    assert_eq!(q, None);
}

#[test]
fn harvest_moves_half_to_vaults_and_burns_half() {
    let mut w = World::new();
    w.g().register("exposed", Kind::Exposed).unwrap();
    w.g().register("vault", Kind::Vault).unwrap();
    w.g().buy("exposed", 20 * N, 0, 0).unwrap();
    w.g().buy("vault", 20 * N, 0, 0).unwrap();
    let e0 = w.bal("exposed");
    let v0 = w.bal("vault");
    let sat0 = w.s.satoshi_balance();
    assert_eq!(w.g().harvest(EPOCH - 1), Err(Error::NothingDue));
    let h = w.g().harvest(EPOCH).unwrap();
    assert_eq!(h.epochs, 1);
    let e1 = w.bal("exposed");
    let v1 = w.bal("vault");
    assert!(e1 < e0 && v1 > v0);
    assert!(w.s.satoshi_balance() < sat0, "Satoshi bleeds too");
    // 5% of the exposed bucket was taken
    assert!((e0 - e1) * 10_000 / e0 >= 499 && (e0 - e1) * 10_000 / e0 <= 500);
    assert_eq!(h.burned + h.to_vaults, h.taken);
    w.check();
    assert_eq!(w.g().harvest(EPOCH), Err(Error::NothingDue));
}

#[test]
fn missed_harvests_catch_up_but_stop_at_q_day() {
    let mut w = World::new();
    w.g().register("v", Kind::Vault).unwrap();
    let h = w.g().harvest(EPOCH * 100).unwrap();
    assert_eq!(h.epochs, 24);
    assert_eq!(w.s.harvested, 24);
    w.check();
}

#[test]
fn harvest_gas_is_constant_in_holder_count() {
    // The harvest touches only bucket totals: the store is never read.
    struct Panicky;
    impl Store for Panicky {
        fn holder(&self, _: &str) -> Option<Holder> { panic!("harvest must not read holders") }
        fn put_holder(&mut self, _: &str, _: Holder) { panic!("harvest must not write holders") }
        fn raid(&self, _: u64) -> Option<Raid> { panic!() }
        fn put_raid(&mut self, _: Raid) { panic!() }
        fn blast(&self, _: u64) -> Option<Blast> { panic!() }
        fn put_blast(&mut self, _: Blast) { panic!() }
    }
    let p = params();
    let mut s = State::genesis(&p, 0);
    let mut st = Panicky;
    Game::new(&p, &mut s, &mut st).harvest(EPOCH).unwrap();
}

#[test]
fn raid_on_exposed_cannot_be_defended_but_can_be_escaped() {
    let mut w = World::new();
    for (id, k) in [("att", Kind::Vault), ("victim", Kind::Exposed), ("victim_vault", Kind::Vault)] {
        w.g().register(id, k).unwrap();
    }
    w.g().buy("att", 20 * N, 0, 0).unwrap();
    w.g().buy("victim", 20 * N, 0, 0).unwrap();

    // Escape: move the bag into a vault before the window ends.
    let id = w.g().raid("att", "victim", 1_000 * T, 0).unwrap();
    assert_eq!(w.g().defend("victim", id, 1), Err(Error::NotVault));
    let all = w.bal("victim");
    w.g().transfer("victim", "victim_vault", all, 2).unwrap();
    assert_eq!(w.g().resolve(id, 600_000), Err(Error::WindowOpen));
    let r = w.g().resolve(id, 600_001).unwrap();
    assert_eq!(r.take, 0, "nothing left to take");
    w.check();
}

#[test]
fn raid_on_exposed_takes_its_share_when_nobody_moves() {
    let mut w = World::new();
    w.g().register("att", Kind::Vault).unwrap();
    w.g().register("victim", Kind::Exposed).unwrap();
    w.g().buy("att", 20 * N, 0, 0).unwrap();
    w.g().buy("victim", 20 * N, 0, 0).unwrap();
    let a0 = w.bal("att");
    let v0 = w.bal("victim");
    let stake = 10_000 * T;
    let id = w.g().raid("att", "victim", stake, 0).unwrap();
    w.check();
    let r = w.g().resolve(id, 600_001).unwrap();
    let expected = (v0 / 10).min(stake * 5);
    assert!(r.take.abs_diff(expected) <= 1);
    assert_eq!(r.burned, r.take / 10);
    assert!(w.bal("att") > a0);
    assert!(w.bal("victim") < v0);
    assert_eq!(w.g().raid("att", "victim", stake, 600_002), Err(Error::TargetImmune));
    w.check();
}

#[test]
fn defended_raid_flips_the_stake() {
    let mut w = World::new();
    w.g().register("att", Kind::Vault).unwrap();
    w.g().register("def", Kind::Vault).unwrap();
    w.g().buy("att", 20 * N, 0, 0).unwrap();
    w.g().buy("def", 20 * N, 0, 0).unwrap();
    let d0 = w.bal("def");
    let stake = 5_000 * T;
    let id = w.g().raid("att", "def", stake, 0).unwrap();
    assert_eq!(w.g().raid("att", "def", stake, 1), Err(Error::TargetBusy));
    assert_eq!(w.g().defend("att", id, 1), Err(Error::NotTarget));
    let r = w.g().defend("def", id, 600_000).unwrap();
    assert_eq!(r.status, RaidStatus::Defended);
    let gained = w.bal("def") - d0;
    assert!(gained.abs_diff(stake - stake / 10) <= 2);
    assert_eq!(w.g().defend("def", id, 600_000), Err(Error::RaidNotOpen));
    w.check();
}

#[test]
fn defend_after_window_fails() {
    let mut w = World::new();
    w.g().register("att", Kind::Vault).unwrap();
    w.g().register("def", Kind::Vault).unwrap();
    w.g().buy("att", 20 * N, 0, 0).unwrap();
    w.g().buy("def", 20 * N, 0, 0).unwrap();
    let id = w.g().raid("att", "def", 1_000 * T, 0).unwrap();
    assert_eq!(w.g().defend("def", id, 600_001), Err(Error::WindowClosed));
}

#[test]
fn shields_follow_square_root_and_reduce_take() {
    let p = params();
    assert_eq!(shield_strength(&p, 1, 100), 1_000);
    assert_eq!(shield_strength(&p, 4, 100), 2_000);
    assert_eq!(shield_strength(&p, 9, 100), 3_000);
    assert_eq!(shield_strength(&p, 50, 100), 6_000, "capped");

    let mut w = World::new();
    w.g().register("att", Kind::Vault).unwrap();
    w.g().register("def", Kind::Vault).unwrap();
    w.g().buy("att", 20 * N, 0, 0).unwrap();
    w.g().buy("def", 20 * N, 0, 0).unwrap();
    let bal = w.bal("def");
    let s = w.g().charge_shield("def", (bal + 24) / 25, 10).unwrap();
    assert_eq!(s, 2_000);
    assert_eq!(w.g().shield_now("def", 11), 2_000);
    let after_burn = w.bal("def");
    let id = w.g().raid("att", "def", 100_000 * T, 20).unwrap();
    let r = w.g().resolve(id, 600_021).unwrap();
    let expected = after_burn / 10 * 8 / 10;
    assert!(r.take.abs_diff(expected) <= 2, "take {} expected {}", r.take, expected);
    // shield expires at the next epoch
    assert_eq!(w.g().shield_now("def", EPOCH), 0);
    w.check();
}

#[test]
fn exposed_cannot_raid_shield_or_hit_the_boss() {
    let mut w = World::new();
    w.g().register("e", Kind::Exposed).unwrap();
    w.g().register("v", Kind::Vault).unwrap();
    w.g().buy("e", 20 * N, 0, 0).unwrap();
    w.g().buy("v", 20 * N, 0, 0).unwrap();
    assert_eq!(w.g().raid("e", "v", 1_000 * T, 0), Err(Error::NotVault));
    assert_eq!(w.g().charge_shield("e", 10 * T, 0), Err(Error::NotVault));
    assert_eq!(w.g().boss_raid("e", 0), Err(Error::NotVault));
}

#[test]
fn boss_once_per_epoch_with_minimum_balance() {
    let mut w = World::new();
    w.g().register("v", Kind::Vault).unwrap();
    w.g().register("poor", Kind::Vault).unwrap();
    w.g().buy("v", 20 * N, 0, 0).unwrap();
    assert_eq!(w.g().boss_raid("poor", 0), Err(Error::BossMinBalance));
    let sat0 = w.s.satoshi_balance();
    let o = w.g().boss_raid("v", 0).unwrap();
    assert_eq!(o.taken, (sat0 * 50 / 10_000).min(10_000 * T));
    assert_eq!(o.burned, o.taken / 5);
    assert_eq!(w.g().boss_raid("v", 1), Err(Error::BossDone));
    assert!(w.g().boss_raid("v", EPOCH).is_ok());
    w.check();
}

#[test]
fn q_day_freezes_exposed_and_ends_the_season() {
    let mut w = World::new();
    w.g().register("e", Kind::Exposed).unwrap();
    w.g().register("v", Kind::Vault).unwrap();
    w.g().register("v2", Kind::Vault).unwrap();
    w.g().buy("e", 20 * N, 0, 0).unwrap();
    w.g().buy("v", 20 * N, 0, 0).unwrap();
    let qd = w.s.q_day_ms(&w.p);
    assert_eq!(w.g().transfer("e", "v", T, qd), Err(Error::Frozen));
    assert_eq!(w.g().sell("e", T, 0, qd), Err(Error::Frozen));
    assert_eq!(w.g().buy("e", N, 0, qd), Err(Error::Frozen));
    assert_eq!(w.g().raid("v", "v2", T * 1_000, qd), Err(Error::QDayPassed));
    assert_eq!(w.g().boss_raid("v", qd), Err(Error::QDayPassed));
    // vaults keep trading
    w.g().transfer("v", "v2", T, qd).unwrap();
    assert!(w.g().sell("v", T, 0, qd).is_ok());
    w.check();
}

/// 10,000 random moves never break the accounting invariant, never mint,
/// and the sum of holder balances never exceeds the bucket totals.
#[test]
fn random_moves_keep_the_books_exact() {
    let mut w = World::new();
    let ids: Vec<String> = (0..12).map(|i| format!("h{i}")).collect();
    for (i, id) in ids.iter().enumerate() {
        let k = if i % 2 == 0 { Kind::Vault } else { Kind::Exposed };
        w.g().register(id, k).unwrap();
    }
    let mut seed: u64 = 0x9e37_79b9_7f4a_7c15;
    let mut rnd = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let mut now: u64 = 0;
    let mut open: Vec<u64> = vec![];
    for _ in 0..10_000 {
        now += rnd() % 120_000;
        let a = &ids[(rnd() % 12) as usize].clone();
        let b = &ids[(rnd() % 12) as usize].clone();
        let bal = w.bal(a);
        let amt = if bal == 0 { 0 } else { (rnd() as u128 * T) % bal.max(1) };
        let _ = match rnd() % 9 {
            0 => w.g().buy(a, (rnd() % 5 + 1) as u128 * N / 2, 0, now).map(|_| ()),
            1 => w.g().sell(a, amt, 0, now).map(|_| ()),
            2 => w.g().transfer(a, b, amt, now),
            3 => w.g().harvest(now).map(|_| ()),
            4 => w.g().raid(a, b, amt.max(100 * T), now).map(|id| open.push(id)),
            5 => match open.pop() { Some(id) => w.g().resolve(id, now).map(|_| ()), None => Ok(()) },
            6 => match open.last() { Some(&id) => w.g().defend(b, id, now).map(|_| ()), None => Ok(()) },
            7 => w.g().charge_shield(a, amt / 20, now).map(|_| ()),
            _ => w.g().boss_raid(a, now).map(|_| ()),
        };
        w.check();
        let sum_e: u128 = ids.iter().filter(|i| w.m.holders[*i].kind == Kind::Exposed).map(|i| w.s.balance(Kind::Exposed, w.m.holders[i].shares)).sum::<u128>() + w.s.satoshi_balance();
        let sum_q: u128 = ids.iter().filter(|i| w.m.holders[*i].kind == Kind::Vault).map(|i| w.s.balance(Kind::Vault, w.m.holders[i].shares)).sum();
        assert!(sum_e <= w.s.e_tokens && sum_q <= w.s.q_tokens);
        let share_e: u128 = ids.iter().filter(|i| w.m.holders[*i].kind == Kind::Exposed).map(|i| w.m.holders[i].shares).sum::<u128>() + w.s.satoshi_shares;
        let share_q: u128 = ids.iter().filter(|i| w.m.holders[*i].kind == Kind::Vault).map(|i| w.m.holders[i].shares).sum();
        assert_eq!(share_e, w.s.e_shares);
        assert_eq!(share_q, w.s.q_shares);
        assert!(w.s.circulating(&w.p) <= w.p.total_supply);
    }
}

#[test]
fn vaults_are_armour_and_no_punching_down() {
    let mut w = World::new();
    w.p.vault_take_bps = 300;
    w.p.punch_down_band = 4;
    for (id, k) in [("whale", Kind::Vault), ("small", Kind::Vault), ("peer", Kind::Vault), ("exp", Kind::Exposed)] {
        w.g().register(id, k).unwrap();
    }
    w.g().buy("whale", 60 * N, 0, 0).unwrap();
    w.g().buy("small", 2 * N, 0, 0).unwrap();
    w.g().buy("peer", 3 * N, 0, 0).unwrap();
    w.g().buy("exp", 3 * N, 0, 0).unwrap();
    assert_eq!(w.g().raid("whale", "small", 10_000 * T, 0), Err(Error::PunchDown));
    // peers can raid each other; vault take is 3%, exposed take is 10%
    let v0 = w.bal("small");
    let id = w.g().raid("peer", "small", 100_000 * T, 0).unwrap();
    let r = w.g().resolve(id, 600_001).unwrap();
    assert!(r.take.abs_diff(v0 * 3 / 100) <= 2);
    let e0 = w.bal("exp");
    let id = w.g().raid("peer", "exp", 100_000 * T, 0).unwrap();
    let r = w.g().resolve(id, 600_001).unwrap();
    assert!(r.take.abs_diff(e0 / 10) <= 2);
    w.check();
}
