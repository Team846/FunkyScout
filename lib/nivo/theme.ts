/**
 * Nivo chart theme that uses CSS variables to match the app's design system.
 * Works with light/dark mode automatically.
 * 
 * Usage:
 * import { NivoChartTheme } from "@lib/nivo";
 * <ResponsiveLine data={data} theme={NivoChartTheme} />
 */
const NivoChartTheme = {
  background: "transparent",
  text: {
    fontSize: 12,
    fill: "var(--text-primary)",
    fontFamily: "Outfit",
    outlineWidth: 0,
    outlineColor: "transparent",
  },
  axis: {
    domain: {
      line: {
        stroke: "var(--text-background)",
        strokeWidth: 1,
      },
    },
    legend: {
      text: {
        fontSize: 12,
        fill: "var(--text-primary)",
        fontFamily: "Outfit",
        outlineWidth: 0,
        outlineColor: "transparent",
      },
    },
    ticks: {
      line: {
        stroke: "var(--primary)",
        strokeWidth: 1,
      },
      text: {
        fontSize: 12,
        fontFamily: "Outfit",
        fill: "var(--text-secondary)",
        outlineWidth: 0,
        outlineColor: "transparent",
      },
    },
  },
  grid: {
    line: {
      stroke: "var(--text-background)",
      strokeWidth: 0.5,
    },
  },
  legends: {
    title: {
      text: {
        fontSize: 11,
        fill: "var(--text-secondary)",
        outlineWidth: 0,
        fontFamily: "Outfit",
        outlineColor: "transparent",
      },
    },
    text: {
      fontSize: 11,
      fill: "var(--text-secondary)",
      outlineWidth: 0,
      fontFamily: "Outfit",
      outlineColor: "transparent",
    },
    ticks: {
      line: {},
      text: {
        fontSize: 10,
        fill: "var(--text-secondary)",
        outlineWidth: 0,
        outlineColor: "transparent",
      },
    },
  },
  tooltip: {
    wrapper: {},
    container: {
      background: "var(--surface)",
      color: "var(--text-primary)",
      fontSize: 15,
    },
    basic: {},
    chip: {},
    table: {},
    tableCell: {},
    tableCellValue: {},
  },
};

export { NivoChartTheme };
