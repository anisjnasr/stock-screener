import { ImageResponse } from "next/og";

export const size = {
  width: 1200,
  height: 600,
};

export const contentType = "image/png";

export default function TwitterImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0b1220, #1f2937)",
          color: "#f8fafc",
          fontFamily: "Inter, Arial, sans-serif",
          padding: "64px",
        }}
      >
        <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.1 }}>Stock Scanner</div>
        <div style={{ fontSize: 28, opacity: 0.92, marginTop: 16 }}>
          Fundamentals, charts, screener, and market insights
        </div>
      </div>
    ),
    size
  );
}

