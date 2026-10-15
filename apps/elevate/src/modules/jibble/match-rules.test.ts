import { describe, expect, it } from "vitest";
import type { JibblePerson } from "./http-client";
import { resolveJibbleAccount } from "./match-rules";

// Invented people only: real Jibble exports never go into tests.
const person = (id: string, email: string | null, code: string | null): JibblePerson => ({ id, email, code, fullName: "Invented Person", status: "Active" });
const people = [
  person("11111111-1111-4111-8111-111111111111", "ana.invented@example.com", "AI-1"),
  person("22222222-2222-4222-8222-222222222222", "ben.invented@example.com", "BI-2"),
  person("33333333-3333-4333-8333-333333333333", null, null),
];

describe("resolveJibbleAccount", () => {
  it("finds an account by the email used in Jibble, ignoring case and spaces", () => {
    expect(resolveJibbleAccount("  Ana.Invented@Example.com ", people)).toMatchObject({ kind: "found", person: { id: people[0].id } });
  });
  it("finds an account by member code, ignoring case", () => {
    expect(resolveJibbleAccount("bi-2", people)).toMatchObject({ kind: "found", person: { id: people[1].id } });
  });
  it("uses a pasted person id as given, without a lookup", () => {
    expect(resolveJibbleAccount("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", [])).toEqual({ kind: "id", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  });
  it("says none when nothing matches, and never matches a partial email or code", () => {
    expect(resolveJibbleAccount("ana.invented@example", people)).toEqual({ kind: "none" });
    expect(resolveJibbleAccount("AI", people)).toEqual({ kind: "none" });
    expect(resolveJibbleAccount("", people)).toEqual({ kind: "none" });
  });
  it("refuses when more than one account has the same email or code", () => {
    const twice = [...people, person("44444444-4444-4444-8444-444444444444", "ana.invented@example.com", "AI-9")];
    expect(resolveJibbleAccount("ana.invented@example.com", twice)).toEqual({ kind: "many" });
    const sameCode = [...people, person("55555555-5555-4555-8555-555555555555", null, "AI-1")];
    expect(resolveJibbleAccount("AI-1", sameCode)).toEqual({ kind: "many" });
  });
  it("does not read a code as an email or an email as a code", () => {
    expect(resolveJibbleAccount("AI-1", [person("77777777-7777-4777-8777-777777777777", "AI-1", null)])).toEqual({ kind: "none" });
    expect(resolveJibbleAccount("a@example.com", [person("88888888-8888-4888-8888-888888888888", null, "a@example.com")])).toEqual({ kind: "none" });
  });
});
