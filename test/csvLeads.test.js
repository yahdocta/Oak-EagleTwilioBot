const assert = require("node:assert/strict");
const test = require("node:test");

const { parseLeadsCsv } = require("../src/campaigns/csvLeads");
const { makeTempDir, writeTempFile } = require("./helpers");

test("parseLeadsCsv reads lead_name rows from a fake CSV", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(
    dir,
    "leads.csv",
    "lead_id,lead_name,lead_phone,ignored\n 001 , Ada Lovelace , +15551234567 , x\n"
  );

  assert.deepEqual(parseLeadsCsv(csvPath), [
    {
      lead_id: "001",
      lead_name: "Ada Lovelace",
      lead_phone: "+15551234567"
    }
  ]);
});

test("parseLeadsCsv builds lead_name from first_name and last_name", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(
    dir,
    "split-name.csv",
    "lead_id,first_name,last_name,lead_phone\nabc,Jaden,Moreno,555-111-2222\n"
  );

  assert.deepEqual(parseLeadsCsv(csvPath), [
    {
      lead_id: "abc",
      lead_name: "Jaden Moreno",
      lead_phone: "555-111-2222"
    }
  ]);
});

test("parseLeadsCsv keeps valid lead city values from known city columns", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(
    dir,
    "city.csv",
    "lead_id,lead_name,lead_phone,city\nabc,Jaden Moreno,555-111-2222, St. Louis \n"
  );

  assert.deepEqual(parseLeadsCsv(csvPath), [
    {
      lead_id: "abc",
      lead_name: "Jaden Moreno",
      lead_phone: "555-111-2222",
      lead_city: "St. Louis"
    }
  ]);
});

test("parseLeadsCsv ignores invalid lead city values", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(
    dir,
    "invalid-city.csv",
    "lead_id,lead_name,lead_phone,property_city\nabc,Jaden Moreno,555-111-2222,90210\n"
  );

  assert.deepEqual(parseLeadsCsv(csvPath), [
    {
      lead_id: "abc",
      lead_name: "Jaden Moreno",
      lead_phone: "555-111-2222"
    }
  ]);
});

test("parseLeadsCsv keeps lead address values from known address columns", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(
    dir,
    "address.csv",
    "lead_id,lead_name,lead_phone,address\nabc,Jaden Moreno,555-111-2222, 123 Oak St  \n"
  );

  assert.deepEqual(parseLeadsCsv(csvPath), [
    {
      lead_id: "abc",
      lead_name: "Jaden Moreno",
      lead_phone: "555-111-2222",
      lead_address: "123 Oak St"
    }
  ]);
});

test("parseLeadsCsv preserves quoted commas and skips empty lines", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(
    dir,
    "quoted.csv",
    "lead_id,lead_name,lead_phone\n\n2,\"Moreno, Jaden\",+15550001111\n"
  );

  assert.equal(parseLeadsCsv(csvPath)[0].lead_name, "Moreno, Jaden");
});

test("parseLeadsCsv returns an empty list for header-only CSVs", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "empty.csv", "lead_id,lead_name,lead_phone\n");

  assert.deepEqual(parseLeadsCsv(csvPath), []);
});

test("parseLeadsCsv rejects missing required columns", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "missing-phone.csv", "lead_id,lead_name\n1,Ada\n");

  assert.throws(() => parseLeadsCsv(csvPath), /missing required column\(s\): lead_phone/);
});

test("parseLeadsCsv rejects CSVs without a usable name column shape", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "missing-name.csv", "lead_id,first_name,lead_phone\n1,Ada,+1\n");

  assert.throws(() => parseLeadsCsv(csvPath), /lead_name.*first_name.*last_name/);
});

test("parseLeadsCsv surfaces malformed CSV errors", () => {
  const dir = makeTempDir();
  const csvPath = writeTempFile(dir, "bad.csv", "lead_id,lead_name,lead_phone\n1,\"Ada,+1\n");

  assert.throws(() => parseLeadsCsv(csvPath), /Quote Not Closed|CSV/);
});
