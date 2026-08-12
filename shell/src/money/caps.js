// The single source of cap truth for the money engine.
//
// Every number the fence enforces lives HERE and nowhere else: the gate
// worker imports this file, the card-creation code derives its declarative
// spending_limits from it, the skill quotes it, and smoke check 35 pins the
// values and fails the build on any stray cap literal elsewhere in money
// code. Changing a cap is a change to this file on a PR the operator merges
// — by construction, not by convention.
//
// All amounts are integer cents.

export const CAPS = {
    PER_TXN_CENTS: 5000,
    PER_DAY_CENTS: 15000,
    PER_TRAINING_RUN_CENTS: 7500,
    FLOAT_START_CENTS: 50000,
    FLOAT_CEILING_CENTS: 100000,
};
