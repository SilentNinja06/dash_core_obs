import { test, is } from "./_harness";
import { currentStreakFromDays } from "../src/core/streak";

// counts[0] = today, counts[1] = yesterday, ...

test("streak: consecutive qualifying days count from today", () => {
	is(currentStreakFromDays([true, true, true]), 3);
	is(currentStreakFromDays([true]), 1);
});

test("streak: a gap ends the count (broken streak)", () => {
	is(currentStreakFromDays([true, true, false, true]), 2);
	is(currentStreakFromDays([true, false, true, true]), 1);
});

test("streak: today not yet done is measured from yesterday (live streak)", () => {
	is(currentStreakFromDays([false, true, true, false]), 2);
	is(currentStreakFromDays([false, true]), 1);
});

test("streak: today and yesterday both missing is a broken streak of 0", () => {
	is(currentStreakFromDays([false, false]), 0);
	is(currentStreakFromDays([false, false, true, true]), 0);
});

test("streak: empty / no data is 0", () => {
	is(currentStreakFromDays([]), 0);
	is(currentStreakFromDays([false]), 0);
});

test("streak: a single not-done today with nothing before is 0", () => {
	is(currentStreakFromDays([false, true, false]), 1);
});
