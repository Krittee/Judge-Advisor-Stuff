"use client";

import { Fragment } from "react";
import { FlagSummary } from "@/components/Flags";
import { formatClock, formatMinutes } from "@/components/ui";
import { groupQueue, minutesSince, pickHero, waitingAlert, type QueueCard } from "@/lib/judgeQueue";
import { STATUS_META } from "@/lib/status";
import type { AppState, AwardView, FlagRow, NominationRow, RequestRow, Team } from "@/lib/types";
import { FinishedCard, type NominateView } from "./Nominate";
import { myAwards, nominationSummary, type Finished, type Me } from "./nominations";
import { BandPill, ChevronDown, ChevronRight, Dot, MessageIcon, StatusPill, TrophyIcon } from "./parts";
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
  /** Open the team sheet. */
  onOpen: (team: Team) => void;
};

/**
 * What the Queue tab needs to let a judge nominate. Left out (or with no
 * awards configured) the tab is as it was before awards.
 */
export type NominateActions = {
  awards: AwardView[];
  /** The panel's nominations, with any tap still saving laid over them. */
  nominations: NominationRow[];
  me: Me;
  /** The team whose finished-interview card takes the hero slot (pickFinished), if any. */
  finished: Finished | null;
  /** A chip tap: nominate (`on`) or withdraw. */
  onToggle: (teamId: string, awardId: string, on: boolean) => void;
  /** The card's Done: collapse it for this team. */
  onDone: (team: Team) => void;
  /** Open the sheet on the chips (a Done row) or on the reasons (the card's Add a reason). */
  onNominate: (team: Team, view: NominateView) => void;
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
  nominate,
  ...ctx
}: Context & {
  cards: QueueCard[];
  /** Teams with a finished interview (completedTeamIds). */
  completed: ReadonlySet<string>;
  nominate?: NominateActions;
}) {
  if (!cards.length) {
    return (
      <p className="jg-empty">
        No teams are assigned to this panel yet. The Judge Advisor assigns them from the admin
        console.
      </p>
    );
  }

  // Awards on: the just-finished team's card takes the hero slot (so it is not in Done while it is there),
  // and the Done rows list their nominations. The teams that would be the hero wait below the card instead.
  const nom = nominate?.awards.length ? nominate : null;
  const finished = nom?.finished ?? null;
  const hero = pickHero(cards);
  const sections = groupQueue(cards, finished?.card ?? hero, completed);
  const heroWaiting = hero?.request?.status === "requested";
  const alert = finished || heroWaiting ? [] : waitingAlert(sections.waiting, ctx.now);
  const rows = (list: QueueCard[]) =>
    list.map((c) => (
      <li key={c.team.id}>
        <Row card={c} {...ctx} />
      </li>
    ));
  const doneRows = (list: QueueCard[]) =>
    nom
      ? list.map((c) => (
          <li key={c.team.id}>
            <DoneRow card={c} nominate={nom} onOpen={ctx.onOpen} />
          </li>
        ))
      : rows(list);

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

      {nom && finished ? (
        <FinishedCard
          finished={finished}
          awards={nom.awards}
          pressed={myAwards(nom.nominations, finished.card.team.id, nom.me)}
          onToggle={(awardId, on) => nom.onToggle(finished.card.team.id, awardId, on)}
          onDone={() => nom.onDone(finished.card.team)}
          onReason={() => nom.onNominate(finished.card.team, "reasons")}
        />
      ) : hero ? (
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
          <ul className="jg-list">{doneRows(sections.done)}</ul>
        </details>
      ) : null}
    </>
  );
}

/**
 * A finished team's row once awards are on: the panel's nominations for it on
 * one line ("Excellence ×2 · Design", ×2 being two judges) and a link to the
 * chips -- Edit, or Nominate when there are none. The rest of the row still
 * opens the team sheet.
 */
function DoneRow({
  card,
  nominate,
  onOpen,
}: {
  card: QueueCard;
  nominate: NominateActions;
  onOpen: (team: Team) => void;
}) {
  const { team } = card;
  const summary = nominationSummary(nominate.nominations, nominate.awards, team.id, nominate.me);
  return (
    <div className="jg-qrow jg-drow">
      <button type="button" className="jg-qmain" onClick={() => onOpen(team)}>
        <span className="jg-qt">
          <span className="jg-q1">
            <b>{team.number}</b>
            <span>{team.name}</span>
          </span>
          <span className={summary ? "jg-dn" : "jg-dn jg-no"}>
            <TrophyIcon />
            {summary || "No nominations"}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="jg-lnk"
        aria-label={`${summary ? "Edit nominations for" : "Nominate"} ${team.number}`}
        onClick={() => nominate.onNominate(team, "chips")}
      >
        {summary ? "Edit" : "Nominate"}
      </button>
    </div>
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
  categories,
  now,
  busy,
  onAdvance,
  onOpen,
}: Context & { card: QueueCard }) {
  const { team, request } = card;
  const status = request?.status;
  const meta = teamMeta(team, categories);
  const action = status ? primaryAction(status) : null;
  const working = busy === (request?.id ?? team.id);
  // A booked team has no button here: it becomes the hero when its turn comes.
  const advanceable = Boolean(request && action && status !== "scheduled");

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
        {advanceable ? null : <ChevronRight />}
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

    </div>
  );
}
