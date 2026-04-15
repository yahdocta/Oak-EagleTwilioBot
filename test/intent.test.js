const assert = require("node:assert/strict");
const test = require("node:test");

const { parseInterestIntent } = require("../src/intent/interest");
const { parsePreferredPhone } = require("../src/intent/phone");

test("parseInterestIntent recognizes positive replies", () => {
  assert.deepEqual(parseInterestIntent("Yeah, that works for me"), {
    intent: "yes",
    confidence: 0.9
  });

  for (const transcript of [
    "I am",
    "I'm interested",
    "yup",
    "absolutely",
    "definitely interested in selling"
  ]) {
    assert.equal(parseInterestIntent(transcript).intent, "yes");
  }
});

test("parseInterestIntent recognizes negative and stop replies", () => {
  assert.deepEqual(parseInterestIntent("Please stop calling this wrong number"), {
    intent: "no",
    confidence: 0.92
  });

  for (const transcript of [
    "nope",
    "nah",
    "no thanks",
    "not right now",
    "I'm not interested",
    "we are not selling"
  ]) {
    assert.equal(parseInterestIntent(transcript).intent, "no");
  }
});

test("parseInterestIntent treats ambiguous replies as unknown", () => {
  assert.deepEqual(parseInterestIntent("yes, no, maybe later"), {
    intent: "unknown",
    confidence: 0.4
  });
});

test("parseInterestIntent handles empty or irrelevant transcripts", () => {
  assert.deepEqual(parseInterestIntent(""), { intent: "unknown", confidence: 0 });
  assert.deepEqual(parseInterestIntent("call me sometime next week"), {
    intent: "unknown",
    confidence: 0.2
  });
});

test("parsePreferredPhone normalizes US phone numbers from punctuation", () => {
  assert.deepEqual(parsePreferredPhone("(555) 123-4567"), {
    phoneRaw: "5551234567",
    phoneNormalized: "+15551234567",
    confidence: 0.88
  });
});

test("parsePreferredPhone normalizes eleven-digit US numbers", () => {
  assert.equal(parsePreferredPhone("1-555-123-4567").phoneNormalized, "+15551234567");
});

test("parsePreferredPhone truncates overly long numbers that start with country code 1", () => {
  assert.equal(parsePreferredPhone("15551234567999").phoneNormalized, "+15551234567");
});

test("parsePreferredPhone converts spoken digits including oh", () => {
  const parsed = parsePreferredPhone("five five five one two three four five six oh");

  assert.equal(parsed.phoneRaw, "5551234560");
  assert.equal(parsed.phoneNormalized, "+15551234560");
});

test("parsePreferredPhone keeps the longer direct digit candidate and normalizes it", () => {
  const parsed = parsePreferredPhone("call 15551234567, extension five");

  assert.equal(parsed.phoneRaw, "15551234567");
  assert.equal(parsed.phoneNormalized, "+15551234567");
});

test("parsePreferredPhone extracts a phone number from extra speech", () => {
  assert.equal(
    parsePreferredPhone("yeah sure you can reach me on my cell at 949 205 6081 after lunch").phoneNormalized,
    "+19492056081"
  );
  assert.equal(
    parsePreferredPhone("my number is five five five one two three four five six seven, thanks").phoneNormalized,
    "+15551234567"
  );
  assert.equal(
    parsePreferredPhone("use 555-123-4567 extension 89").phoneNormalized,
    "+15551234567"
  );
});

test("parsePreferredPhone rejects empty, short, and non-US numbers", () => {
  assert.deepEqual(parsePreferredPhone(""), {
    phoneRaw: "",
    phoneNormalized: null,
    confidence: 0
  });
  assert.equal(parsePreferredPhone("555").phoneNormalized, null);
  assert.equal(parsePreferredPhone("+44 20 7123 4567").phoneNormalized, null);
});
