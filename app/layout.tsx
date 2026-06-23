import "./globals.css";
import Nav from "./Nav";

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
      <body>
        <div className="container">
          <Nav />
          {children}
        </div>
      </body>
    </html>
  );
}
