//! Integer helpers. All token and NEAR amounts are u128 base units; products
//! that can exceed u128 go through 256-bit intermediates.

uint::construct_uint! {
    pub struct U256(4);
}

/// floor(a * b / c). Panics if c == 0 or the result does not fit u128.
pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    assert!(c != 0, "mul_div by zero");
    let r = U256::from(a) * U256::from(b) / U256::from(c);
    r.try_into().expect("mul_div overflow")
}

/// ceil(a * b / c).
pub fn mul_div_ceil(a: u128, b: u128, c: u128) -> u128 {
    assert!(c != 0, "mul_div by zero");
    let num = U256::from(a) * U256::from(b);
    let d = U256::from(c);
    let q = num / d;
    let r = if num % d == U256::zero() { q } else { q + U256::one() };
    r.try_into().expect("mul_div overflow")
}

/// ceil(k / d) for a 256-bit k.
pub fn div_ceil_256(k: U256, d: u128) -> u128 {
    assert!(d != 0, "div by zero");
    let d = U256::from(d);
    let q = k / d;
    let r = if k % d == U256::zero() { q } else { q + U256::one() };
    r.try_into().expect("div overflow")
}

/// Integer square root (floor).
pub fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    let mut x = (n as f64).sqrt() as u128;
    // Correct any floating point error.
    while x * x > n {
        x -= 1;
    }
    while (x + 1) * (x + 1) <= n {
        x += 1;
    }
    x
}

pub fn bps(amount: u128, bps: u32) -> u128 {
    mul_div(amount, bps as u128, 10_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mul_div_handles_large_products() {
        let a = 21_000_000u128 * 10u128.pow(18);
        let b = 30u128 * 10u128.pow(24);
        assert_eq!(mul_div(a, b, b), a);
        assert_eq!(mul_div_ceil(10, 1, 3), 4);
        assert_eq!(mul_div(10, 1, 3), 3);
    }

    #[test]
    fn isqrt_exact() {
        for n in [0u128, 1, 2, 3, 4, 15, 16, 17, 1_000_000, u64::MAX as u128] {
            let r = isqrt(n);
            assert!(r * r <= n && (r + 1) * (r + 1) > n, "n={n}");
        }
    }
}
