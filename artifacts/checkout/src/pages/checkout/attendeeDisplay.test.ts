import { describe, expect, it } from "vitest";
import { getAttendeeDisplay } from "./attendeeDisplay";

describe("getAttendeeDisplay", () => {
  it("uses a safe numbered fallback for a TBC attendee with null names", () => {
    expect(
      getAttendeeDisplay(
        {
          firstName: null,
          lastName: null,
          workEmail: "",
          isTbc: true,
        },
        1,
      ),
    ).toEqual({
      initials: "2",
      name: "Attendee 2 (TBC)",
      email: "Details to be confirmed",
    });
  });

  it("uses trimmed initials and details for a named attendee", () => {
    expect(
      getAttendeeDisplay(
        {
          firstName: " Douglas ",
          lastName: " Leach ",
          workEmail: "douglas@example.com",
          isTbc: false,
        },
        0,
      ),
    ).toEqual({
      initials: "DL",
      name: "Douglas Leach",
      email: "douglas@example.com",
    });
  });
});
