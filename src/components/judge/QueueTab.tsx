"use client";

import { Fragment } from "react";
import { FlagSummary } from "@/components/Flags";
import { formatClock, formatMinutes } from "@/components/ui";
import { groupQueue, minutesSince, pickHero, waitingAlert, type QueueCard } from "@/lib/judgeQueue";
import { STATUS_META } from "@/lib/status";
import type { AppState, FlagRow, RequestRow, Team } from "@/lib/types";
import { BandPill, ChevronDown, ChevronRight, CloseIcon, Dot, MessageIcon, PlusIcon, StatusPill } from "./parts";
import {
  dueText,
  flagDetail,
  interviewTimer,
  leadFlag,
  primaryAction,
  teamMeta,
} from "./logic";

/** What the Queue tab does with a team. The page owns the writes. */
export type QueueActions = {
  /** Move the request one step on (On our way / Start / Finish). */
  onAdvance: (request: RequestRow) => void;
  /** Cancel the request. The page asks first. */
  onCancel: (team: Team, request: RequestRow) => void;
  /** Put a team with no request into the queue. */
  onSummon: (team: Team) => void;
  /** Open the team sheet. */
  onOpen: (team: Team) => void;
};

type Context = QueueActions & {
  categories: AppState["categories"];
  languages: AppState["languages"];
  flags: FlagRow[];
  flagKinds: AppState["flagKinds"];
  now: number;
  /** The request id or team id with a write in the air. */
  busy: string | null;
};

/**
 * The Queue tab: the hero card for whoever is next, the alert row when
 * teams are waiting behind an interview, and everyone else in sections.
 */
export function QueueTab({
  cards,
  completed,
  ...ctx
}: Context & {
  cards: QueueCard[];
  /** Teams with a finished interview (completedTeamIds). */
  completed: ReadonlySet<string>;
}) {
  if (!cards.length) {
    return (
      <p className="jg-empty">
        No teams are assigned to this panel yet. The Judge Advisor assigns them from the admin
        console.
      </p>
    );
  }

  const hero = pickHero(cards);
  const sections = groupQueue(cards, hero, completed);
  const heroWaiting = hero?.request?.status === "requested";
  const alert = heroWaiting ? [] : waitingAlert(sections.waiting, ctx.now);
  const rows = (list: QueueCard[], done = false) =>
    list.map((c) => (
      <li key={c.team.id}>
        <Row card={c} done={done} {...ctx} />
      </li>
    ));

  return (
    <>
      {alert.length ? (
        <div className="jg-alert" role="status">
          <Dot status="requested" />
          <span className="jg-at">
            <b>
              {alert.length} {alert.length === 1 ? "team" : "teams"} waiting
            </b>
            <span>
              {alert.map((a) => `${a.team.number} ${formatMinutes(a.minutes)}`).join(" · ")}
            </span>
          </span>
          <button
            type="button"
            className="jg-lnk"
            onClick={() => document.getElementById("jg-waiting")?.scrollIntoView({ block: "start" })}
          >
            View
          </button>
        </div>
      ) : null}

      {hero ? (
        <Hero card={hero} {...ctx} />
      ) : (
        <p className="jg-empty">Nobody is waiting or booked right now.</p>
      )}

      {sections.waiting.length ? (
        <Section id="jg-waiting" status="requested" title="Waiting" count={sections.waiting.length}>
          {rows(sections.waiting)}
        </Section>
      ) : null}

      {sections.withUs.length ? (
        <Section status="acknowledged" title="With us" count={sections.withUs.length}>
          {rows(sections.withUs)}
        </Section>
      ) : null}

      {sections.booked.length ? (
        <Section status="scheduled" title="Booked" count={sections.booked.length}>
          {rows(sections.booked)}
        </Section>
      ) : null}

      {sections.notInQueue.length ? (
        <Section title="Not in queue" count={sections.notInQueue.length}>
          {rows(sections.notInQueue)}
        </Section>
      ) : null}

      {sections.done.length ? (
        <details className="jg-done">
          <summary>
            <Dot status="completed" />
            Done · {sections.done.length}
            <span className="jg-dp">{sections.done.map((c) => c.team.number).join(" · ")}</span>
            <ChevronDown />
          </summary>
          <ul className="jg-list">{rows(sections.done, true)}</ul>
        </details>
      ) : null}
    </>
  );
}

function Section({
  id,
  status,
  title,
  count,
  children,
}: {
  id?: string;
  status?: RequestRow["status"];
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="jg-grp" id={id}>
      <h2 className="jg-sec">
        <Dot status={status} />
        {title} · {count}
      </h2>
      <ul className="jg-list">{children}</ul>
    </div>
  );
}

/** The hero's wait or slot line: "waiting 6 min", "10:40 AM · in 4 min". */
function heroWhen(request: RequestRow, now: number): React.ReactNode {
  if (request.status === "requested") {
    return <b className="jg-wt">waiting {formatMinutes(minutesSince(request.requested_at, now))}</b>;
  }
  if (request.status === "scheduled" && request.slot_start) {
    const due = dueText(request.slot_start, now);
    return (
      <>
        <b>{formatClock(request.slot_start)}</b>
        {due ? ` · ${due}` : ""}
      </>
    );
  }
  return null;
}

function Hero({
  card,
  categories,
  languages,
  flags,
  flagKinds,
  now,
  busy,
  onAdvance,
  onCancel,
  onOpen,
}: Context & { card: QueueCard }) {
  const { team, score } = card;
  const request = card.request!; // pickHero only returns teams with a request
  const status = request.status;
  const action = primaryAction(status);
  const mine = flags.filter((f) => f.team_id === team.id);
  const lead = leadFlag(mine, flagKinds);
  const language = languages.find((l) => l.id === request.language)?.short;
  const category = categories.find((c) => c.id === team.category)?.label;
  const working = busy === request.id;

  const interviewing = status === "interviewing";
  const eyebrow = interviewing ? "Now interviewing" : status === "acknowledged" ? "On the way" : "Up next";
  const tint = status === "requested" ? "jg-t-waiting" : interviewing ? "jg-t-active" : "";

  return (
    <section className={`jg-hero ${tint}`} aria-label={interviewing ? "Interviewing now" : eyebrow}>
      <div className="jg-hero-top">
        <span className="jg-eyebrow">{eyebrow}</span>
        <StatusPill status={status} />
      </div>

      <div className="jg-hid">
        <div className="jg-hid-t">
          <h2 className="jg-hn">{team.number}</h2>
          <p className="jg-hname">{team.name}</p>
        </div>
        {score.max > 0 ? (
          <div className="jg-hscore">
            {/* A team with no marks is not on 0: say so, rather than print a number that reads as a real score. */}
            {score.scored ? (
              <>
                <b>
                  {score.total}
                  <small>/{score.max}</small>
                </b>
                <BandPill {...score} />
              </>
            ) : (
              <span className="jg-ns">not scored</span>
            )}
          </div>
        ) : null}
      </div>

      <div className="jg-hmeta">
        {category ? <span className="jg-ptag">{category}</span> : null}
        {language ? <span className="jg-ptag">{language}</span> : null}
        <span>
          {[team.pit ? `Pit ${team.pit}` : null, heroWhen(request, now)]
            .filter(Boolean)
            .map((part, i) => (
              <Fragment key={i}>
                {i ? " · " : null}
                {part}
              </Fragment>
            ))}
        </span>
      </div>

      {interviewing ? <Timer since={request.started_at ?? request.updated_at} now={now} /> : null}

      {lead ? (
        <div className="jg-flagrow">
          <FlagSummary flags={mine} kinds={flagKinds} />
          <span>{[flagDetail(lead), `by ${lead.author}`].filter(Boolean).join(" · ")}</span>
        </div>
      ) : null}

      {request.message ? (
        <blockquote className="jg-msg">
          <MessageIcon />
          <p>“{request.message}”</p>
        </blockquote>
      ) : null}

      {action ? (
        <button
          type="button"
          className={`jg-go jg-s-${action.to}`}
          disabled={working}
          onClick={() => onAdvance(request)}
        >
          {/* The label changes, not just the colour: a disabled button on
              venue wifi reads as a dead button, which is what had judges
              tapping again. */}
          {working ? "Saving…" : action.label}
        </button>
      ) : null}

      {interviewing ? (
        <button type="button" className="jg-opensheet" onClick={() => onOpen(team)}>
          <span className="jg-ot">
            <b>Open team sheet</b>
            <small>Score the interview · notes · notebook</small>
          </span>
          <ChevronRight />
        </button>
      ) : null}

      <div className="jg-hrow">
        {interviewing ? null : (
          <button type="button" className="jg-ghost jg-lg" onClick={() => onOpen(team)}>
            Notes &amp; scores
          </button>
        )}
        <button
          type="button"
          className="jg-quiet"
          disabled={working}
          onClick={() => onCancel(team, request)}
        >
          Cancel request
        </button>
      </div>
    </section>
  );
}

function Timer({ since, now }: { since: string; now: number }) {
  const { big, small } = interviewTimer(minutesSince(since, now), since);
  return (
    <div className="jg-tmr">
      <b>{big}</b>
      <span>{small}</span>
    </div>
  );
}

function Row({
  card,
  done = false,
  categories,
  now,
  busy,
  onAdvance,
  onCancel,
  onSummon,
  onOpen,
}: Context & { card: QueueCard; done?: boolean }) {
  const { team, request } = card;
  const status = request?.status;
  const meta = teamMeta(team, categories);
  const action = status ? primaryAction(status) : null;
  const working = busy === (request?.id ?? team.id);
  // A booked team has no button here: it becomes the hero when its turn comes.
  const advanceable = Boolean(request && action && status !== "scheduled");
  const addable = !request && !done;

  // The second line: how long they have stood there, or where they are in the day.
  let line: React.ReactNode = meta;
  if (request && status === "requested") {
    line = (
      <>
        <Dot status="requested" />
        <span className="jg-wt">Waiting {formatMinutes(minutesSince(request.requested_at, now))}</span>
        {meta ? ` · ${meta}` : ""}
      </>
    );
  } else if (request && (status === "acknowledged" || status === "interviewing")) {
    line = (
      <>
        <Dot status={status} />
        {STATUS_META[status!].short}
        {meta ? ` · ${meta}` : ""}
      </>
    );
  } else if (request && status === "scheduled") {
    const due = dueText(request.slot_start, now);
    line = (
      <>
        {meta}
        {due ? (
          <>
            {meta ? " · " : ""}
            <b>{due}</b>
          </>
        ) : null}
      </>
    );
  }

  return (
    <div className={`jg-qrow ${status === "requested" ? "jg-qw" : ""}`}>
      <button type="button" className="jg-qmain" onClick={() => onOpen(team)}>
        <span className="jg-qt">
          <span className="jg-q1">
            <b>{team.number}</b>
            <span>{team.name}</span>
          </span>
          <span className="jg-q2">{line}</span>
        </span>
        {status === "scheduled" && request?.slot_start ? (
          <span className="jg-sc jg-s-scheduled">{formatClock(request.slot_start)}</span>
        ) : null}
        {advanceable || addable ? null : <ChevronRight />}
      </button>

      {advanceable && request && action ? (
        <button
          type="button"
          className={`jg-go jg-sm jg-s-${action.to}`}
          disabled={working}
          onClick={() => onAdvance(request)}
        >
          {working ? "Saving…" : action.label}
        </button>
      ) : null}

      {/* A sibling of the row's tap target, so it never opens the sheet. Quiet, and the page asks first. */}
      {request ? (
        <button
          type="button"
          className="jg-cx"
          aria-label={`Cancel ${team.number}'s request`}
          disabled={working}
          onClick={() => onCancel(team, request)}
        >
          <CloseIcon />
        </button>
      ) : null}

      {addable ? (
        <button type="button" className="jg-ghost" disabled={working} onClick={() => onSummon(team)}>
          {working ? (
            "Adding…"
          ) : (
            <>
              <PlusIcon />
              Add to queue
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
