import { ChatStreamParser, readableChatError } from "@psx/shared/chat/stream";

// The Copilot answers as newline-delimited JSON over a stream, so chunk
// boundaries fall wherever the network puts them. Both the browser and the
// phone now share this parser, and the failure it has to survive is a line
// arriving in pieces.

describe("ChatStreamParser", () => {
  it("emits whole events from a single chunk", () => {
    const parser = new ChatStreamParser();
    const events = parser.push('{"type":"text","delta":"Hello"}\n{"type":"done"}\n');
    expect(events).toEqual([{ type: "text", delta: "Hello" }, { type: "done" }]);
  });

  it("holds a line that is split across chunks", () => {
    const parser = new ChatStreamParser();
    expect(parser.push('{"type":"text","del')).toEqual([]);
    expect(parser.push('ta":"Hi"}\n')).toEqual([{ type: "text", delta: "Hi" }]);
  });

  it("holds a line split mid-token across three chunks", () => {
    const parser = new ChatStreamParser();
    expect(parser.push('{"type"')).toEqual([]);
    expect(parser.push(':"done"')).toEqual([]);
    expect(parser.push("}\n")).toEqual([{ type: "done" }]);
  });

  it("does not emit a trailing line until its newline arrives", () => {
    const parser = new ChatStreamParser();
    expect(parser.push('{"type":"done"}')).toEqual([]);
    expect(parser.flush()).toEqual([{ type: "done" }]);
  });

  it("ignores blank lines", () => {
    const parser = new ChatStreamParser();
    expect(parser.push('\n\n{"type":"done"}\n\n')).toEqual([{ type: "done" }]);
  });

  it("reports a malformed line without dropping the ones around it", () => {
    // One bad line must not cost the user the rest of the answer.
    const parser = new ChatStreamParser();
    const events = parser.push('{"type":"text","delta":"a"}\nnot json\n{"type":"done"}\n');
    expect(events[0]).toEqual({ type: "text", delta: "a" });
    expect(events[1]).toMatchObject({ type: "parse-error", reason: "invalid JSON" });
    expect(events[2]).toEqual({ type: "done" });
  });

  it("reports valid JSON that is not an event", () => {
    const parser = new ChatStreamParser();
    expect(parser.push('{"delta":"orphan"}\n')[0]).toMatchObject({
      type: "parse-error",
      reason: "no event type",
    });
  });

  it("carries an artifact spec through untouched", () => {
    const parser = new ChatStreamParser();
    const spec = { kind: "metric-strip", title: "Book", items: [{ label: "Value", value: "1" }] };
    const [event] = parser.push(`${JSON.stringify({ type: "artifact", spec })}\n`);
    expect(event).toEqual({ type: "artifact", spec });
  });

  it("passes a server error through as an event, not silence", () => {
    // This one is from a real failure: the API answered with an error event,
    // the client had no case for it, and the phone showed an empty answer with
    // no explanation. Every event type the route can send must survive parsing.
    const parser = new ChatStreamParser();
    const [event] = parser.push('{"type":"error","message":"Credit balance is too low"}\n');
    expect(event).toEqual({ type: "error", message: "Credit balance is too low" });
  });

  it("passes the event types a phone ignores but must not choke on", () => {
    const parser = new ChatStreamParser();
    const events = parser.push(
      '{"type":"meta","meta":{"model":"claude"}}\n' +
        '{"type":"incomplete","reason":"deadline"}\n' +
        '{"type":"thinking","delta":"hm"}\n'
    );
    expect(events.map((e) => e.type)).toEqual(["meta", "incomplete", "thinking"]);
  });

  it("flush is empty when everything already ended on a newline", () => {
    const parser = new ChatStreamParser();
    parser.push('{"type":"done"}\n');
    expect(parser.flush()).toEqual([]);
  });
});

describe("readableChatError", () => {
  it("pulls the sentence out of a forwarded provider error", () => {
    const raw =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."},"request_id":"req_1"}';
    expect(readableChatError(raw)).toBe(
      "Your credit balance is too low to access the Anthropic API."
    );
  });

  it("leaves a plain message alone", () => {
    expect(readableChatError("Chat failed")).toBe("Chat failed");
  });

  it("falls back to the original when the JSON has no message", () => {
    const raw = '500 {"type":"error","code":"oops"}';
    expect(readableChatError(raw)).toBe(raw);
  });

  it("falls back to the original when the JSON will not parse", () => {
    const raw = "502 {not json";
    expect(readableChatError(raw)).toBe(raw);
  });
});
