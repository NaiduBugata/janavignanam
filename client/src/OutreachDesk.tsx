import { useEffect, useMemo, useState } from "react";
import { ClipboardList, HeartHandshake } from "lucide-react";
import { api } from "@/lib/api.ts";
import { BENEFITS } from "@/EventRecordForm.tsx";

type Person = {
  id: string;
  title: string;
  fullName?: string;
  detail: string;
  status: string;
  date: string;
  contactNumber?: string;
  designation?: string;
  village?: string;
  mandal?: string;
  division?: string;
  assemblyConstituency?: string;
  categories?: string[];
  followUpKind?: string;
  place?: string;
  visitDate?: string;
  visitTime?: string;
  leadPhone?: string;
  assignedOfficer?: string;
  actionToBeTaken?: string;
  section?: string;
};

type Tab = "events" | "followups";

const FOLLOW_UPS = [
  { id: "frequent", label: "Frequently contacted" },
  { id: "recent", label: "Recently contacted" },
  { id: "pending", label: "Not followed up" },
] as const;

function nameOf(item: Person): string {
  return item.fullName || item.title || "Person";
}

function placeOf(item: Person): string {
  return [item.village, item.mandal, item.assemblyConstituency || item.place, item.division].filter(Boolean).join(", ");
}

function benefitOf(item: Person): string {
  return item.status || item.categories?.[0] || "Other benefit";
}

function whenOf(value: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!day) return value || "Date not set";
  return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function bucketOf(item: Person): (typeof FOLLOW_UPS)[number]["id"] {
  if (item.followUpKind === "frequent" || item.followUpKind === "recent" || item.followUpKind === "pending") {
    return item.followUpKind;
  }
  return "pending";
}

export function OutreachDesk({ token, view }: { token: string; view: "outreach" | "schedule" }) {
  const [tab, setTab] = useState<Tab>("events");
  const [events, setEvents] = useState<Person[]>([]);
  const [followups, setFollowups] = useState<Person[]>([]);
  const [schedule, setSchedule] = useState<Person[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = (section: string) =>
      api<Person[]>(`/api/workspace/records?section=${section}`, { token });
    const request = view === "schedule"
      ? Promise.all([load("schedules"), load("visits")]).then(([scheduleRows, visitRows]) => {
          if (cancelled) return;
          setSchedule(
            [...scheduleRows, ...visitRows].sort((a, b) =>
              (a.visitDate || a.date || "9999-99-99").localeCompare(b.visitDate || b.date || "9999-99-99"),
            ),
          );
          setError("");
        })
      : Promise.all([load("events"), load("followups")]).then(([benefitRows, followRows]) => {
          if (cancelled) return;
          setEvents(benefitRows);
          setFollowups(followRows);
          setError("");
        });
    request.catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Could not load these records");
    });
    return () => {
      cancelled = true;
    };
  }, [token, view]);

  const benefitCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const benefit of BENEFITS) counts.set(benefit, 0);
    for (const item of events) {
      const benefit = benefitOf(item);
      counts.set(benefit, (counts.get(benefit) || 0) + 1);
    }
    return counts;
  }, [events]);

  return (
    <div>
      <div className="mb-8">
        <p className="mb-2 text-sm font-medium uppercase tracking-wider text-primary">MP desk</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{view === "schedule" ? "Schedule" : "Events and follow ups"}</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">{view === "schedule" ? "Visits and the things still to be done. Add these records from the upload page under Schedules or Visits." : "People who received a benefit, and who needs a follow up. Add these records from the upload page."}</p>
      </div>
      {view === "outreach" && (
      <div className="mb-6 flex flex-wrap gap-2">
        {([
          ["events", "Events", HeartHandshake],
          ["followups", "Follow ups", ClipboardList],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium ${tab === id ? "bg-primary text-primary-foreground" : "border bg-background hover:bg-muted"}`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
      )}
      {error && <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {view === "outreach" && tab === "events" && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-card p-4">
              <p className="text-sm text-muted-foreground">People benefited</p>
              <p className="mt-1 font-display text-3xl font-semibold">{events.length}</p>
            </div>
            <div className="rounded-xl border bg-card p-4">
              <p className="text-sm text-muted-foreground">CMRF</p>
              <p className="mt-1 font-display text-3xl font-semibold">{benefitCounts.get("CMRF / Medical Assistance") || 0}</p>
            </div>
            {BENEFITS.filter((benefit) => benefit !== "CMRF / Medical Assistance").map((benefit) => (
              <div key={benefit} className="rounded-xl border bg-card p-4">
                <p className="text-sm text-muted-foreground">{benefit}</p>
                <p className="mt-1 font-display text-3xl font-semibold">{benefitCounts.get(benefit) || 0}</p>
              </div>
            ))}
          </div>
          {events.length ? (
            <div className="overflow-hidden rounded-xl border bg-card">
              {events.map((item, index) => (
                <article key={item.id} className="border-b px-5 py-4 last:border-0">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 min-w-8 items-center justify-center rounded-md bg-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                    <div className="min-w-0">
                      <h2 className="font-medium">{nameOf(item)}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">{[item.designation, item.contactNumber, benefitOf(item)].filter(Boolean).join(" · ")}</p>
                      <p className="mt-1 text-sm">{placeOf(item) || "Place not set"}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{whenOf(item.date)}{item.detail ? ` · ${item.detail}` : ""}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty text="No benefits yet. Add them from the upload page under Events." />
          )}
        </div>
      )}

      {view === "outreach" && tab === "followups" && (
        <div className="grid gap-4 lg:grid-cols-3">
          {FOLLOW_UPS.map((group) => {
            const rows = followups.filter((item) => bucketOf(item) === group.id);
            return (
              <section key={group.id} className="rounded-xl border bg-card">
                <header className="border-b px-4 py-3">
                  <h2 className="font-medium">{group.label}</h2>
                  <p className="text-sm text-muted-foreground">{rows.length} {rows.length === 1 ? "person" : "people"}</p>
                </header>
                {rows.length ? (
                  <div>
                    {rows.map((item, index) => (
                      <article key={item.id} className="border-b px-4 py-3 last:border-0">
                        <p className="text-xs font-semibold tabular-nums text-muted-foreground">S.No {index + 1}</p>
                        <h3 className="mt-1 font-medium">{nameOf(item)}</h3>
                        <p className="mt-1 text-sm">{item.designation || "Designation not set"}</p>
                        <p className="mt-1 text-sm tabular-nums">{item.contactNumber || "Phone not set"}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{placeOf(item) || "Place not set"}</p>
                        {item.detail ? <p className="mt-1 text-sm">{item.detail}</p> : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="px-4 py-6 text-sm text-muted-foreground">None in this group. Add the person from the upload page under Follow ups.</p>
                )}
              </section>
            );
          })}
        </div>
      )}

      {view === "schedule" && (
        schedule.length ? (
          <div className="space-y-3">
            {schedule.map((item, index) => {
              const kind = item.section === "visits" || item.status === "Visit" ? "Visit" : "To do";
              return (
                <article key={`${item.section}-${item.id}`} className="rounded-xl border bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-primary">S.No {index + 1} · {kind}</p>
                      <h2 className="mt-1 font-display text-xl font-semibold">{item.title || nameOf(item)}</h2>
                    </div>
                    <p className="text-sm font-medium">{whenOf(item.visitDate || item.date)}{item.visitTime ? ` · ${item.visitTime}` : ""}</p>
                  </div>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">Place</dt><dd>{item.place || "Not set"}</dd></div>
                    <div><dt className="text-muted-foreground">Constituency</dt><dd>{item.assemblyConstituency || "Not set"}</dd></div>
                    <div><dt className="text-muted-foreground">Mandal and village</dt><dd>{[item.mandal, item.village].filter(Boolean).join(", ") || "Not set"}</dd></div>
                    <div><dt className="text-muted-foreground">Person</dt><dd>{[item.assignedOfficer || item.fullName, item.designation, item.leadPhone || item.contactNumber].filter(Boolean).join(" · ") || "Not set"}</dd></div>
                  </dl>
                  {item.actionToBeTaken ? <p className="mt-4 text-sm"><span className="font-medium">Things to be done: </span>{item.actionToBeTaken}</p> : null}
                  {item.detail ? <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p> : null}
                </article>
              );
            })}
          </div>
        ) : (
          <Empty text="No visits or tasks yet. Add them from the upload page under Schedules or Visits." />
        )
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">{text}</div>;
}
