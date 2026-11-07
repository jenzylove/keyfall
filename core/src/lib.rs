//! Q-DAY rules, shared by the NEAR contract and the simulation.

pub mod game;
pub mod math;
pub mod params;

pub use game::*;
pub use params::{Params, DECIMALS, ONE, ONE_NEAR};

use std::collections::HashMap;

/// In-memory store for the simulation and tests.
#[derive(Default, Clone)]
pub struct MemStore {
    pub holders: HashMap<String, Holder>,
    pub raids: HashMap<u64, Raid>,
}

impl Store for MemStore {
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
}
