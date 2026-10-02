import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import type { Block, Inline } from "@/lib/markdown";
import { latin } from "@/modules/privacy/pdf";

// The offer letter as a PDF. Standard Helvetica (Latin-1 only: other characters become "?"), so a letter never fails to draw.
// Signatures are not drawn here: ELEVATE Sign adds a signature page and a certificate when everyone has signed.

const styles = StyleSheet.create({
  page: { paddingTop: 56, paddingBottom: 64, paddingHorizontal: 60, fontFamily: "Helvetica", fontSize: 11, lineHeight: 1.45, color: "#1f1b2d" },
  brand: { flexDirection: "row", alignItems: "center", marginBottom: 22, borderBottomWidth: 2, borderBottomColor: "#8A2BE2", paddingBottom: 8 },
  brandText: { fontFamily: "Helvetica-Bold", fontSize: 14, color: "#8A2BE2" },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 18, marginTop: 4, marginBottom: 10 },
  h3: { fontFamily: "Helvetica-Bold", fontSize: 13, marginTop: 12, marginBottom: 6 },
  h4: { fontFamily: "Helvetica-Bold", fontSize: 11.5, marginTop: 8, marginBottom: 4 },
  p: { marginBottom: 8 },
  quote: { marginBottom: 8, marginLeft: 12, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: "#c9b8f0", color: "#4a4560" },
  li: { flexDirection: "row", marginBottom: 3 },
  bullet: { width: 16 },
  footer: { position: "absolute", bottom: 28, left: 60, right: 60, fontSize: 8.5, color: "#6b6680", flexDirection: "row", justifyContent: "space-between" },
});

function inline(nodes: Inline[], key = ""): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.type) {
      case "text":
        return latin(n.text);
      case "strong":
        return (
          <Text key={k} style={{ fontFamily: "Helvetica-Bold" }}>
            {inline(n.children, `${k}-`)}
          </Text>
        );
      case "em":
        return (
          <Text key={k} style={{ fontFamily: "Helvetica-Oblique" }}>
            {inline(n.children, `${k}-`)}
          </Text>
        );
      case "code":
        return (
          <Text key={k} style={{ fontFamily: "Courier" }}>
            {latin(n.text)}
          </Text>
        );
      case "link":
        return inline(n.children, `${k}-`); // links in a letter are drawn as their label only
    }
  });
}

function OfferDocument({ title, blocks, footer }: { title: string; blocks: Block[]; footer: string }) {
  return (
    <Document title={latin(title)} author="Elite Resource Services" creator="ELEVATE" producer="ELEVATE">
      <Page size="LETTER" style={styles.page}>
        <View style={styles.brand} fixed>
          <Text style={styles.brandText}>Elite Resource Services</Text>
        </View>
        {blocks.map((b, i) => {
          if (b.type === "heading") return <Text key={i} style={b.level === 2 ? styles.h2 : b.level === 3 ? styles.h3 : styles.h4}>{inline(b.children)}</Text>;
          if (b.type === "paragraph") return <Text key={i} style={styles.p}>{inline(b.children)}</Text>;
          if (b.type === "quote") return <Text key={i} style={styles.quote}>{inline(b.children)}</Text>;
          return (
            <View key={i} style={{ marginBottom: 6 }}>
              {b.items.map((item, j) => (
                <View key={j} style={styles.li} wrap={false}>
                  <Text style={styles.bullet}>{b.ordered ? `${j + 1}.` : "•"}</Text>
                  <Text style={{ flex: 1 }}>{inline(item)}</Text>
                </View>
              ))}
            </View>
          );
        })}
        <View style={styles.footer} fixed>
          <Text>{latin(footer)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderOfferPdf(input: { title: string; blocks: Block[]; footer: string }): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<OfferDocument {...input} />);
  return new Uint8Array(buffer);
}
