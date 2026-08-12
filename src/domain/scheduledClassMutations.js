import { addDays } from "./dates.js";
import { createClassSchedule, createScheduleChange, createScheduleException } from "./ids.js";
import { dayOfWeekForDate } from "./schedule.js";

function sourceOccurrenceDate(session) {
  return session?.occurrenceDate || session?.classDate || "";
}

function sourceGroupId(session) {
  return session?.sourceGroupId || session?.groupId || "";
}

function sourceSlotId(session) {
  return session?.sourceScheduleSlotId || session?.scheduleSlotId || "";
}

function exceptionMatchesSession(exception, session) {
  if (session.exceptionId && exception.id === session.exceptionId) return true;
  if (session.classScheduleId) {
    return (
      exception.classScheduleId === session.classScheduleId &&
      exception.occurrenceDate === sourceOccurrenceDate(session)
    );
  }
  return (
    (exception.sourceGroupId || exception.groupId) === sourceGroupId(session) &&
    (exception.sourceScheduleSlotId || exception.scheduleSlotId) === sourceSlotId(session) &&
    exception.occurrenceDate === sourceOccurrenceDate(session)
  );
}

function isExceptionFromSeries(exception, session) {
  if (session.classScheduleId) return exception.classScheduleId === session.classScheduleId;
  return (
    (exception.sourceGroupId || exception.groupId) === sourceGroupId(session) &&
    (exception.sourceScheduleSlotId || exception.scheduleSlotId) === sourceSlotId(session)
  );
}

function normalizedDraft(session, draft) {
  const format = draft.format === "individual" ? "individual" : "group";
  return {
    classDate: draft.classDate,
    startTime: draft.startTime,
    durationHours: Number(draft.durationHours),
    format,
    groupId: format === "group" ? draft.groupId || "" : "",
    studentId: format === "individual" ? draft.studentId || "" : "",
    participantMode: format === "group" && draft.participantMode === "custom" ? "custom" : "default",
    participantIds:
      format === "group" && draft.participantMode === "custom"
        ? [...new Set((draft.participantIds || []).filter(Boolean))]
        : [],
    originalClassDate: session.classDate,
  };
}

function assertSafeMutation(session, asOfDate) {
  if (!session) throw new Error("Choose a scheduled class first.");
  if ((session.rows || []).length)
    throw new Error("Recorded classes must be edited from History; their schedule is protected.");
  if (sourceOccurrenceDate(session) < asOfDate)
    throw new Error("Past classes are protected and cannot be rescheduled.");
  if (!session.classScheduleId && !sourceSlotId(session) && !session.exceptionId) {
    throw new Error("This class is not linked to an editable schedule.");
  }
}

function assertDraft(draft, minimumDate) {
  if (!draft.classDate || draft.classDate < minimumDate) throw new Error("Choose a valid future date.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.startTime || "")) throw new Error("Choose a valid class time.");
  if (!Number.isFinite(draft.durationHours) || draft.durationHours < 0.25)
    throw new Error("Choose a valid class duration.");
  if (draft.format === "group" && !draft.groupId) throw new Error("Choose a group.");
  if (draft.format === "individual" && !draft.studentId) throw new Error("Choose a student.");
}

function upsertException(items, next, session) {
  const found = items.some((item) => exceptionMatchesSession(item, session));
  return found
    ? items.map((item) => (exceptionMatchesSession(item, session) ? { ...next, id: item.id } : item))
    : [...items, next];
}

function exceptionFor(session, draft, status = "Scheduled") {
  const fields = {
    classScheduleId: session.classScheduleId || "",
    sourceGroupId: sourceGroupId(session),
    sourceScheduleSlotId: sourceSlotId(session),
    groupId: draft.groupId,
    studentId: draft.studentId,
    format: draft.format,
    scheduleSlotId: sourceSlotId(session),
    occurrenceDate: sourceOccurrenceDate(session),
    classDate: draft.classDate,
    startTime: draft.startTime,
    durationHours: draft.durationHours,
    participantMode: draft.participantMode,
    participantIds: draft.participantIds,
    status,
    kind: session.kind === "added" && !session.classScheduleId ? "added" : "override",
  };
  return createScheduleException(session.exceptionId ? { ...fields, id: session.exceptionId } : fields);
}

function recurringSource(state, session) {
  if (!session) return false;
  if (session.classScheduleId) {
    return state.classSchedules.find((item) => item.id === session.classScheduleId)?.recurrence === "weekly";
  }
  return Boolean(sourceGroupId(session) && sourceSlotId(session));
}

export function scheduledClassSupportsFutureScope(state, session) {
  return Boolean(session) && recurringSource(state, session);
}

export function editScheduledClassState(state, { session, draft: rawDraft, scope = "occurrence", asOfDate }) {
  assertSafeMutation(session, asOfDate);
  const draft = normalizedDraft(session, rawDraft);
  const futureScope = scope === "future" && recurringSource(state, session);
  assertDraft(draft, futureScope ? sourceOccurrenceDate(session) : asOfDate);

  if (!futureScope) {
    const exception = exceptionFor(session, draft);
    return {
      ...state,
      scheduleExceptions: upsertException(state.scheduleExceptions || [], exception, session),
    };
  }

  const effectiveFrom = sourceOccurrenceDate(session);
  const remainingExceptions = (state.scheduleExceptions || []).filter(
    (item) => !isExceptionFromSeries(item, session) || item.occurrenceDate < effectiveFrom,
  );

  if (session.classScheduleId) {
    const source = state.classSchedules.find((item) => item.id === session.classScheduleId);
    if (!source) throw new Error("The recurring class could not be found.");
    const oldDay = dayOfWeekForDate(effectiveFrom);
    const newDay = dayOfWeekForDate(draft.classDate);
    const nextDays = [...new Set((source.daysOfWeek || [oldDay]).map((day) => (day === oldDay ? newDay : day)))].sort();
    const { id: _sourceId, endDate: _sourceEndDate, ...sourceFields } = source;
    const replacement = createClassSchedule({
      ...sourceFields,
      recurrence: "weekly",
      startDate: draft.classDate,
      endDate: "",
      startTime: draft.startTime,
      durationHours: draft.durationHours,
      daysOfWeek: nextDays,
      format: draft.format,
      groupId: draft.groupId,
      studentId: draft.studentId,
      participantMode: draft.participantMode,
      participantIds: draft.participantIds,
    });
    return {
      ...state,
      classSchedules: [
        ...state.classSchedules.map((item) =>
          item.id === source.id ? { ...item, endDate: addDays(effectiveFrom, -1) } : item,
        ),
        replacement,
      ],
      scheduleExceptions: remainingExceptions,
    };
  }

  const group = state.groups.find((item) => item.id === sourceGroupId(session));
  const slot = group?.weeklySchedule?.find((item) => item.id === sourceSlotId(session));
  if (!group || !slot) throw new Error("The recurring class could not be found.");
  const stopChange = createScheduleChange({
    groupId: group.id,
    scheduleSlotId: slot.id,
    effectiveFrom,
    dayOfWeek: slot.dayOfWeek,
    startTime: slot.startTime,
    durationHours: slot.durationHours,
    status: "Cancelled",
  });
  const replacement = createClassSchedule({
    recurrence: "weekly",
    startDate: draft.classDate,
    startTime: draft.startTime,
    durationHours: draft.durationHours,
    intervalWeeks: 1,
    daysOfWeek: [dayOfWeekForDate(draft.classDate)],
    format: draft.format,
    groupId: draft.groupId,
    studentId: draft.studentId,
    participantMode: draft.participantMode,
    participantIds: draft.participantIds,
  });
  return {
    ...state,
    classSchedules: [...state.classSchedules, replacement],
    scheduleChanges: [...(state.scheduleChanges || []), stopChange],
    scheduleExceptions: remainingExceptions,
  };
}

export function removeScheduledClassState(state, { session, scope = "occurrence", asOfDate }) {
  assertSafeMutation(session, asOfDate);
  const futureScope = scope === "future" && recurringSource(state, session);
  if (!futureScope) {
    const draft = normalizedDraft(session, {
      classDate: session.classDate,
      startTime: session.startTime,
      durationHours: session.durationHours,
      format: session.format,
      groupId: session.groupId,
      studentId: session.studentId,
      participantMode: session.participantMode,
      participantIds: session.participantIds,
    });
    const exception = exceptionFor(session, draft, "Cancelled");
    return {
      ...state,
      scheduleExceptions: upsertException(state.scheduleExceptions || [], exception, session),
    };
  }

  const effectiveFrom = sourceOccurrenceDate(session);
  const scheduleExceptions = (state.scheduleExceptions || []).filter(
    (item) => !isExceptionFromSeries(item, session) || item.occurrenceDate < effectiveFrom,
  );
  if (session.classScheduleId) {
    return {
      ...state,
      classSchedules: state.classSchedules.map((item) =>
        item.id === session.classScheduleId ? { ...item, endDate: addDays(effectiveFrom, -1) } : item,
      ),
      scheduleExceptions,
    };
  }

  const group = state.groups.find((item) => item.id === sourceGroupId(session));
  const slot = group?.weeklySchedule?.find((item) => item.id === sourceSlotId(session));
  if (!group || !slot) throw new Error("The recurring class could not be found.");
  return {
    ...state,
    scheduleChanges: [
      ...(state.scheduleChanges || []),
      createScheduleChange({
        groupId: group.id,
        scheduleSlotId: slot.id,
        effectiveFrom,
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        durationHours: slot.durationHours,
        status: "Cancelled",
      }),
    ],
    scheduleExceptions,
  };
}
