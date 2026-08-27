/*
 * The seven templates, named once.
 *
 * The keys are the backend's — config/analytics.js `templates` — and the
 * registry that draws them is components/common/ChartTemplates.jsx. This file
 * is only the human-readable half: what to call each one in a menu, and which
 * icon to put beside it.
 *
 * The order is the canvas's switcher order and is deliberate: the comparison
 * shapes first, then distribution and relationship, with the table last as the
 * always-available fallback.
 */

import {
  BarChart3, LineChart, AreaChart, PieChart,
  Layers, ScatterChart, Table2,
} from 'lucide-react';

export const VISUALS = [
  { key: 'bar', label: 'Bar chart', icon: BarChart3 },
  { key: 'line', label: 'Line chart', icon: LineChart },
  { key: 'area', label: 'Area chart', icon: AreaChart },
  { key: 'pie', label: 'Pie chart', icon: PieChart },
  { key: 'stacked_bar', label: 'Stacked bars', icon: Layers },
  { key: 'scatter', label: 'Scatter plot', icon: ScatterChart },
  { key: 'table', label: 'Table', icon: Table2 },
];

const BY_KEY = new Map(VISUALS.map((v) => [v.key, v]));

export const visualLabel = (key) => BY_KEY.get(key)?.label || key;
export const visualIcon = (key) => BY_KEY.get(key)?.icon || Table2;

/*
 * The sizes a card can be set to from its right-click menu.
 *
 * Presets rather than a free numeric width, because the useful question is
 * "how much of the row should this take" and the answers on a twelve-column
 * grid are a third, a half, two thirds and all of it. The drag handle is still
 * there for anything in between.
 */
export const SIZE_PRESETS = [
  // `h` is a pixel height, not a row count — see GRID_ROW_HEIGHT in the
  // backend's dashboardCards config for why the grid is measured this way.
  { label: 'Small', w: 4, h: 256 },
  { label: 'Medium', w: 6, h: 336 },
  { label: 'Large', w: 8, h: 440 },
  { label: 'Full width', w: 12, h: 440 },
];
