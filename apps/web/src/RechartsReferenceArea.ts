// Split out of charts.tsx on its own so that file's other exports (plain
// constants/functions) don't trip react-refresh/only-export-components —
// this is the one component-shaped export among them.
import type { ComponentProps, ComponentType } from "react";
import { ReferenceArea } from "recharts";

/** recharts@3's ReferenceArea prop type resolves almost all SVG props (fill,
 *  stroke, even style) out of its public type, so cast once here rather than
 *  at every call site. */
export const RechartsReferenceArea = ReferenceArea as ComponentType<
  ComponentProps<typeof ReferenceArea> & Record<string, unknown>
>;
