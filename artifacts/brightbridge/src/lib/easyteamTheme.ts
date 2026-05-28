export const brightbridgeTheme = {
  tokens: {
    colors: {
      primary: "#284362",
      secondary: "#E8622A",
      background: "#FFFFFF",
      text: "#1e293b",
      border: "#e2e8f0",
    },
    fonts: {
      header: "Inter, sans-serif",
      body: "Inter, sans-serif",
    },
    fontSizes: {
      small: "12px",
      medium: "14px",
      large: "16px",
    },
    fontWeights: {
      regular: "400",
      medium: "500",
      bold: "600",
    },
    radii: {
      sm: "4px",
      md: "8px",
      lg: "12px",
    },
    spacing: {
      gutter: "16px",
      padding: "12px",
    },
    shadows: {
      small: "0 1px 3px rgba(0,0,0,0.08)",
      medium: "0 4px 12px rgba(0,0,0,0.10)",
    },
  },
  components: {
    Clock: {
      strings: {
        clockInButton: "Clock In",
        clockOutButton: "Clock Out",
        startBreakButton: "Start Break",
        endBreakButton: "End Break",
      },
      actionButtonPrimary: {
        backgroundColor: "#E8622A",
        color: "#FFFFFF",
        borderRadius: "8px",
        fontFamily: "Inter, sans-serif",
        fontWeight: 600,
      },
      actionButtonSecondary: {
        backgroundColor: "#FFFFFF",
        color: "#284362",
        borderColor: "#284362",
        borderRadius: "8px",
        fontFamily: "Inter, sans-serif",
        fontWeight: 500,
      },
      timeCounter: {
        color: "#284362",
        fontFamily: "Inter, sans-serif",
        fontWeight: 700,
      },
    },
    Timesheet: {
      tableHeader: {
        backgroundColor: "#f8fafc",
        color: "#284362",
        fontFamily: "Inter, sans-serif",
        fontWeight: 600,
      },
      tableRow: {
        backgroundColor: "#FFFFFF",
      },
      tableRowValue: {
        color: "#1e293b",
        fontFamily: "Inter, sans-serif",
      },
      actionButtonPrimary: {
        backgroundColor: "#E8622A",
        color: "#FFFFFF",
        borderRadius: "8px",
        fontFamily: "Inter, sans-serif",
        fontWeight: 600,
      },
      actionButtonSecondary: {
        backgroundColor: "#FFFFFF",
        color: "#284362",
        borderColor: "#284362",
        borderRadius: "8px",
        fontFamily: "Inter, sans-serif",
      },
    },
    Schedule: {
      actionButtonPrimary: {
        backgroundColor: "#E8622A",
        color: "#FFFFFF",
        borderRadius: "8px",
        fontFamily: "Inter, sans-serif",
        fontWeight: 600,
      },
      actionButtonSecondary: {
        backgroundColor: "#FFFFFF",
        color: "#284362",
        borderColor: "#284362",
        borderRadius: "8px",
        fontFamily: "Inter, sans-serif",
      },
      tableHeader: {
        backgroundColor: "#f8fafc",
        color: "#284362",
        fontFamily: "Inter, sans-serif",
        fontWeight: 600,
      },
    },
  },
};
