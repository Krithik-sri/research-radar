export const metadata = {
  title: "Research Radar",
  description: "Internal post-training research knowledge base & bot",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          maxWidth: 720,
          margin: "40px auto",
          padding: "0 16px",
          lineHeight: 1.5,
        }}
      >
        {children}
      </body>
    </html>
  );
}
