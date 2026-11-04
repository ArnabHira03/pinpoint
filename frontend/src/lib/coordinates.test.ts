import { popoverPlacement, toNormalized, toPercentStyle } from "./coordinates";

const rect = { left: 100, top: 50, width: 400, height: 200 };

test("normalizes a click relative to the image rect", () => {
  expect(toNormalized(300, 150, rect)).toEqual({ x: 0.5, y: 0.5 });
  expect(toNormalized(200, 100, rect)).toEqual({ x: 0.25, y: 0.25 });
});

test("edges map to exactly 0 and 1", () => {
  expect(toNormalized(100, 50, rect)).toEqual({ x: 0, y: 0 });
  expect(toNormalized(500, 250, rect)).toEqual({ x: 1, y: 1 });
});

test("clicks outside the image are ignored", () => {
  expect(toNormalized(99, 150, rect)).toBeNull();
  expect(toNormalized(501, 150, rect)).toBeNull();
  expect(toNormalized(300, 49, rect)).toBeNull();
  expect(toNormalized(300, 251, rect)).toBeNull();
});

test("a zero-size rect (image not laid out) yields null", () => {
  expect(toNormalized(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
});

test("the same image point gives the same result at any rendered size or offset", () => {
  const small = { left: 0, top: 0, width: 720, height: 450 };
  const large = { left: 260, top: -900, width: 1440, height: 900 }; // scrolled, page offset
  const a = toNormalized(small.left + 0.3 * small.width, small.top + 0.8 * small.height, small);
  const b = toNormalized(large.left + 0.3 * large.width, large.top + 0.8 * large.height, large);
  expect(a).toEqual({ x: 0.3, y: 0.8 });
  expect(b).toEqual(a);
});

test("rounds to 6 decimal places", () => {
  expect(toNormalized(100 + 400 / 3, 50, rect)).toEqual({ x: 0.333333, y: 0 });
});

test("percent style round-trips the normalized point", () => {
  expect(toPercentStyle(0, 1)).toEqual({ left: "0%", top: "100%" });
  expect(toPercentStyle(0.25, 0.5)).toEqual({ left: "25%", top: "50%" });
});

test("popover flips away from the right and bottom edges", () => {
  expect(popoverPlacement(0.5, 0.5)).toEqual({ flipX: false, flipY: false });
  expect(popoverPlacement(0.61, 0.71)).toEqual({ flipX: true, flipY: true });
});
