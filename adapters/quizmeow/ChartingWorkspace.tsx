"use client";

import { useEffect, useRef } from "react";
import { mountChartingModule } from "../../core/index.js";
import "../../core/styles.css";

type Mode = "student" | "builder" | "grader";

export interface ChartingWorkspaceProps {
  mode: Mode;
  template: unknown;
  assignment?: unknown;
  submission?: unknown;
  initialAnswers?: Record<string, unknown>;
  onSaveDraft?: (answers: Record<string, unknown>) => void;
  onSubmit?: (answers: Record<string, unknown>) => void;
  onSaveGrade?: (grade: unknown) => void;
}

/** Mounts the vanilla charting module into quizMeow. Host owns data fetching. */
export default function ChartingWorkspace(props: ChartingWorkspaceProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const handle = mountChartingModule(container, props);
    return () => handle.destroy();
    // Remount when the assignment or mode changes; callbacks are read fresh via props identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode, props.template, props.assignment, props.submission]);

  return <div ref={ref} />;
}
