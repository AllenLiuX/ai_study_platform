"use client";

import type {
  AudioTrainerConfig,
  DecisionTreeConfig,
  DragOrderConfig,
  FlashcardsSrsConfig,
  SimulatorConfig,
  TemplateTrainerSpec,
  TimedDrillConfig,
} from "@/lib/practice/spec";

import { AudioTrainer } from "./AudioTrainer";
import { DecisionTree } from "./DecisionTree";
import { DragOrder } from "./DragOrder";
import { FlashcardsSRS } from "./FlashcardsSRS";
import { Simulator } from "./Simulator";
import { TimedDrill } from "./TimedDrill";

export function TrainerRenderer({
  spec,
  specId,
}: {
  spec: TemplateTrainerSpec;
  specId?: string;
}) {
  const cfg = spec.config;
  switch (spec.template_id) {
    case "simulator":
      return <Simulator config={cfg as SimulatorConfig} />;
    case "timed_drill":
      return <TimedDrill config={cfg as TimedDrillConfig} storageKey={specId} />;
    case "audio_trainer":
      return <AudioTrainer config={cfg as AudioTrainerConfig} />;
    case "flashcards_srs":
      return <FlashcardsSRS config={cfg as FlashcardsSrsConfig} storageKey={specId} />;
    case "drag_order":
      return <DragOrder config={cfg as DragOrderConfig} />;
    case "decision_tree":
      return <DecisionTree config={cfg as DecisionTreeConfig} />;
    default:
      return (
        <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
          未知训练器类型：{spec.template_id}
        </div>
      );
  }
}
