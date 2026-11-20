import { describe, expect, it } from "vitest";
import { extractMentions, mentionToken, mentionsEveryone, splitMentions } from "./mentions";

const ID = "11111111-1111-4111-8111-111111111111";

describe("mentionsEveryone", () => {
  it("sees @everyone and @all typed on their own, in any case, with punctuation after", () => {
    for (const text of ["@everyone", "@all hands at 9", "hello @Everyone!", "ok @ALL, thanks", "(@all)", "line one\n@all"]) expect(mentionsEveryone(text)).toBe(true);
  });
  it("ignores look-alikes: words, emails, other names, and a person named All", () => {
    for (const text of ["@allison", "@alliance", "ana@all.com", "mail me at x@everyone.org", "email@all", "@all-hands", "@alls", "hi all", "everyone", `@[all](user:${ID})`, `@[Everyone](user:${ID})`]) {
      expect(mentionsEveryone(text), text).toBe(false);
    }
  });
});

describe("splitMentions with @everyone", () => {
  it("makes a chip of @everyone next to a person chip and plain text", () => {
    const parts = splitMentions(`Hey ${mentionToken("Ana", ID)} and @everyone, see you`);
    expect(parts).toEqual([{ text: "Hey " }, { mention: { name: "Ana", userId: ID } }, { text: " and " }, { mention: { name: "everyone", userId: "everyone" } }, { text: ", see you" }]);
  });
  it("leaves look-alikes as plain text and person mentions unchanged", () => {
    expect(splitMentions("write to ana@all.com or @allison")).toEqual([{ text: "write to ana@all.com or @allison" }]);
    expect(extractMentions(`@everyone ${mentionToken("Ana", ID)}`)).toEqual([ID]);
  });
});
