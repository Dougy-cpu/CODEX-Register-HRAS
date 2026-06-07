interface AttendeeDisplaySource {
  firstName?: string | null;
  lastName?: string | null;
  workEmail?: string | null;
  isTbc?: boolean;
}

export function getAttendeeDisplay(attendee: AttendeeDisplaySource, index: number) {
  const firstName = (attendee.firstName ?? "").trim();
  const lastName = (attendee.lastName ?? "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const fallbackName = attendee.isTbc ? `Attendee ${index + 1} (TBC)` : `Attendee ${index + 1}`;
  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`;

  return {
    initials: initials || String(index + 1),
    name: attendee.isTbc
      ? fullName
        ? `${fullName} (TBC)`
        : fallbackName
      : fullName || fallbackName,
    email:
      (attendee.workEmail ?? "").trim() ||
      (attendee.isTbc ? "Details to be confirmed" : "Email not provided"),
  };
}
