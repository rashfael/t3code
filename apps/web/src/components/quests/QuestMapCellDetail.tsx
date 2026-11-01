import type { QuestEvidenceRef } from "@t3tools/contracts";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { MarkdownThreadLink } from "../chat/MarkdownThreadLink";
import { Button } from "../ui/button";
import { useQuest } from "./questContext";
import { evidenceFile, type MapEffect } from "./questMapEffects";
import { resultDispositionLabels } from "./QuestPlanChanges";
import type { PlacedUnit } from "./questTerritory";

/** What a cell shows, by semantic ids, so a pin survives relayout, folding and new records. */
export interface CellSelection {
  readonly key: string;
  readonly kind: PlacedUnit["kind"];
  readonly workId: string;
  readonly effectIds: ReadonlyArray<string>;
}

export function cellSelection(unit: PlacedUnit): CellSelection {
  return {
    key: unit.key,
    kind: unit.kind,
    workId: unit.workId,
    effectIds: unit.effects.map((effect) => effect.id),
  };
}

const basisLabels: Record<string, string> = {
  "source-backed-reconstruction": "Reconstructed from delivery records",
};

export function QuestMapCellDetail({
  selection,
  effects,
  pinned,
  onPin,
  onClose,
  onExpand,
}: {
  selection: CellSelection;
  effects: ReadonlyMap<string, MapEffect>;
  pinned: boolean;
  onPin: (selection: CellSelection) => void;
  onClose: () => void;
  onExpand: ((workId: string) => void) | null;
}) {
  const { state, openPanel } = useQuest();
  const members = selection.effectIds
    .map((id) => effects.get(id))
    .filter((effect) => effect !== undefined);
  const first = members[0];
  if (!first) return null;
  const workTitle = (id: string | null) =>
    (id && state.work.find((item) => item.id === id)?.title) ?? "unplaced";
  const region = workTitle(selection.workId);
  const pinEffect = (effect: MapEffect) =>
    onPin({ key: effect.id, kind: "effect", workId: selection.workId, effectIds: [effect.id] });
  const listed = members.length > 1;
  const home = workTitle(first.homeWorkId);
  const kindLabel =
    selection.kind === "aggregate"
      ? first.parentId
        ? `${members.length} effects of one result`
        : "Folded results"
      : selection.kind === "reference"
        ? listed
          ? `${members.length} results recorded in ${home}`
          : "Recorded elsewhere"
        : first.planned
          ? "Planned effect"
          : "Result effect";
  const heading =
    selection.kind === "aggregate"
      ? first.parentId
        ? (effects.get(first.parentId)?.contribution.title ?? "Grouped results")
        : `${members.length} results in ${home}`
      : listed
        ? home
        : first.contribution.title;
  return (
    <section aria-label={`Result: ${heading}`} className="grid gap-3 p-3 text-sm">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {kindLabel} · in {region} · {pinned ? "pinned" : "preview"}
          </p>
          <h3 className="mt-0.5 font-medium">{heading}</h3>
        </div>
        {pinned ? (
          <Button size="icon-xs" variant="ghost" aria-label="Unpin" onClick={onClose}>
            <XIcon />
          </Button>
        ) : null}
      </header>
      {listed ? (
        <>
          <ul className="grid gap-1">
            {members.map((effect) => (
              <li key={effect.id}>
                <button
                  type="button"
                  className="w-full min-w-0 rounded px-1.5 py-1 text-start hover:bg-accent"
                  onClick={() => pinEffect(effect)}
                >
                  <span className="block">
                    {effect.planned ? "Planned · " : ""}
                    {effect.contribution.title}
                  </span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    {effect.contribution.summary}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {onExpand && selection.kind === "aggregate" ? (
            <Button size="xs" variant="outline" onClick={() => onExpand(selection.workId)}>
              Show each
            </Button>
          ) : null}
        </>
      ) : (
        <EffectBody
          effect={first}
          effects={effects}
          reference={selection.kind === "reference"}
          onPinEffect={pinEffect}
        />
      )}
      <footer className="flex flex-wrap gap-1.5">
        <Button
          size="xs"
          variant="ghost"
          onClick={() => openPanel({ type: "work", id: selection.workId })}
        >
          Open scope
        </Button>
      </footer>
    </section>
  );
}

function EffectBody({
  effect,
  effects,
  reference,
  onPinEffect,
}: {
  effect: MapEffect;
  effects: ReadonlyMap<string, MapEffect>;
  reference: boolean;
  onPinEffect: (effect: MapEffect) => void;
}) {
  const { state, openPanel, showView } = useQuest();
  const result = effect.contribution;
  const parent = effect.parentId ? effects.get(effect.parentId) : undefined;
  const parts = effect.childIds.map((id) => effects.get(id)).filter((item) => item !== undefined);
  const title = (id: string) => state.work.find((item) => item.id === id)?.title ?? id;
  const workLink = (id: string) => (
    <button
      key={id}
      type="button"
      className="cursor-pointer text-start underline underline-offset-2"
      onClick={() => openPanel({ type: "work", id })}
    >
      {title(id)}
    </button>
  );
  const rounds = effect.episodes.length + effect.refinements.length + effect.history.length;
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {resultDispositionLabels[result.disposition]} · {result.provenance}
        {effect.basis ? ` · ${basisLabels[effect.basis] ?? effect.basis}` : ""} · revision{" "}
        {result.recordedRevision}
      </p>
      {reference && effect.homeWorkId ? (
        <p className="text-xs">
          {parts.length > 0
            ? `Carried by ${parts.length} finer effects; it also applies here.`
            : "Its filled cell is in "}
          {parts.length > 0 ? null : workLink(effect.homeWorkId)}
        </p>
      ) : null}
      {result.summary ? <p className="whitespace-pre-wrap">{result.summary}</p> : null}
      {parent ? (
        <Field label="Part of">
          <button
            type="button"
            className="cursor-pointer text-start underline underline-offset-2"
            onClick={() => onPinEffect(parent)}
          >
            {parent.contribution.title}
          </button>
        </Field>
      ) : null}
      {parts.length > 0 ? (
        <Field label="Finer effects">
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {parts.map((part) => (
              <button
                key={part.id}
                type="button"
                className="cursor-pointer text-start underline underline-offset-2"
                onClick={() => onPinEffect(part)}
              >
                {part.contribution.title}
              </button>
            ))}
          </span>
        </Field>
      ) : null}
      {result.candidate ? <Field label="Candidate">{result.candidate}</Field> : null}
      {result.evidence.length > 0 ? (
        <Field label="Evidence">
          <ul className="grid gap-1">
            {result.evidence.map((item) => (
              <li key={`${item.kind}:${item.ref}`}>
                <Evidence item={item} effects={effects} onPinEffect={onPinEffect} />
              </li>
            ))}
          </ul>
        </Field>
      ) : null}
      {rounds > 0 ? (
        <Field label="Review and corrections">
          <ul className="grid gap-1">
            {effect.episodes.map((episode) => (
              <li key={episode.id}>
                <span className="text-muted-foreground">
                  {[episode.kind, episode.lens, episode.checkedCandidate]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {episode.outcome ? <span>: {episode.outcome}</span> : null}
              </li>
            ))}
            {effect.refinements.map((note) => (
              <li key={note}>{note}</li>
            ))}
            {effect.history.map((earlier) => (
              <li key={earlier.id} className="text-muted-foreground">
                Earlier version: {earlier.title} · revision {earlier.recordedRevision}
              </li>
            ))}
          </ul>
        </Field>
      ) : null}
      {result.limitations ? <Field label="Limitations">{result.limitations}</Field> : null}
      {result.openQuestions ? <Field label="Open questions">{result.openQuestions}</Field> : null}
      {effect.alsoWorkIds.length > 0 ? (
        <Field label="Also affects">
          <span className="flex flex-wrap gap-x-3 gap-y-1">{effect.alsoWorkIds.map(workLink)}</span>
        </Field>
      ) : null}
      <div>
        <Button
          size="xs"
          variant="outline"
          onClick={() => showView("decisions", { question: result.id })}
        >
          Open result
        </Button>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function Evidence({
  item,
  effects,
  onPinEffect,
}: {
  item: QuestEvidenceRef;
  effects: ReadonlyMap<string, MapEffect>;
  onPinEffect: (effect: MapEffect) => void;
}) {
  const { state, environmentId, openDocument } = useQuest();
  const note = item.note ? <span className="text-muted-foreground"> · {item.note}</span> : null;
  const result = effects.get(item.ref);
  if (result)
    return (
      <>
        <button
          type="button"
          className="cursor-pointer text-start underline underline-offset-2"
          onClick={() => onPinEffect(result)}
        >
          {result.contribution.title}
        </button>
        {note}
      </>
    );
  if (item.kind === "file" || item.kind === "document") {
    const file = evidenceFile(state, item.ref);
    if (file)
      return (
        <>
          <button
            type="button"
            className="cursor-pointer text-start underline underline-offset-2"
            onClick={() => openDocument(file.id)}
          >
            {file.title}
          </button>
          {note}
        </>
      );
  }
  if (item.kind === "thread") {
    const link = parseThreadLinkHref(item.ref.replace(/^<|>$/g, ""));
    if (link)
      return (
        <>
          <MarkdownThreadLink environmentId={environmentId} link={link} label={item.note || null} />
        </>
      );
  }
  return (
    <>
      <span className="text-muted-foreground">{item.kind} </span>
      <code className="break-all">{item.ref}</code>
      {note}
    </>
  );
}
