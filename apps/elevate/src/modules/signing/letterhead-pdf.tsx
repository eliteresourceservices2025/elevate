import "server-only";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { Block } from "@/lib/markdown";
import { latin } from "@/modules/privacy/pdf";
import { renderInlineNodes } from "@/modules/offers/offer-pdf";
import { LOGO_ASPECT, LOGO_PNG_DATA_URI } from "./brand-logo";

// The ELITE document design (from the NDA): the logo centered at the top of the first page with room above it, the document title
// centered and bold, one-inch side margins, a faint logo watermark on every page, and a footer with the company name and the page
// number. Signatures are not drawn here: ELEVATE Sign adds a signature page and a certificate when everyone has signed.

const LOGO_WIDTH = 84;
const WATERMARK_WIDTH = 400;

const styles = StyleSheet.create({
  page: { paddingTop: 54, paddingBottom: 72, paddingHorizontal: 72, fontFamily: "Helvetica", fontSize: 11, lineHeight: 1.5, color: "#1f1b2d" },
  watermark: { position: "absolute", left: (612 - WATERMARK_WIDTH) / 2, top: (792 - WATERMARK_WIDTH / LOGO_ASPECT) / 2, width: WATERMARK_WIDTH, opacity: 0.07 },
  header: { alignItems: "center", marginBottom: 22 },
  logo: { width: LOGO_WIDTH, height: LOGO_WIDTH / LOGO_ASPECT },
  title: { marginTop: 14, fontFamily: "Helvetica-Bold", fontSize: 20, textAlign: "center", lineHeight: 1.25 },
  h2: { fontFamily: "Helvetica-Bold", fontSize: 14, marginTop: 12, marginBottom: 6 },
  h3: { fontFamily: "Helvetica-Bold", fontSize: 12, marginTop: 10, marginBottom: 5 },
  h4: { fontFamily: "Helvetica-Bold", fontSize: 11, marginTop: 8, marginBottom: 4 },
  p: { marginBottom: 8 },
  quote: { marginBottom: 8, marginLeft: 12, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: "#c9b8f0", color: "#4a4560" },
  li: { flexDirection: "row", marginBottom: 3, paddingLeft: 10 },
  bullet: { width: 16 },
  footer: { position: "absolute", bottom: 32, left: 72, right: 72, fontSize: 9, flexDirection: "row", justifyContent: "space-between", color: "#4a4560" },
  footerName: { fontFamily: "Helvetica-Bold", letterSpacing: 0.6 },
});

function LetterheadDocument({ title, blocks }: { title: string; blocks: Block[] }) {
  return (
    <Document title={latin(title)} author="Elite Resource Services" creator="ELEVATE" producer="ELEVATE">
      <Page size="LETTER" style={styles.page}>
        <Image src={LOGO_PNG_DATA_URI} style={styles.watermark} fixed />
        <View style={styles.header}>
          <Image src={LOGO_PNG_DATA_URI} style={styles.logo} />
          <Text style={styles.title}>{latin(title)}</Text>
        </View>
        {blocks.map((b, i) => {
          if (b.type === "heading") return <Text key={i} style={b.level === 2 ? styles.h2 : b.level === 3 ? styles.h3 : styles.h4}>{renderInlineNodes(b.children)}</Text>;
          if (b.type === "paragraph") return <Text key={i} style={styles.p}>{renderInlineNodes(b.children)}</Text>;
          if (b.type === "quote") return <Text key={i} style={styles.quote}>{renderInlineNodes(b.children)}</Text>;
          return (
            <View key={i} style={{ marginBottom: 6 }}>
              {b.items.map((item, j) => (
                <View key={j} style={styles.li} wrap={false}>
                  <Text style={styles.bullet}>{b.ordered ? `${j + 1}.` : "•"}</Text>
                  <Text style={{ flex: 1 }}>{renderInlineNodes(item)}</Text>
                </View>
              ))}
            </View>
          );
        })}
        <View style={styles.footer} fixed>
          <Text style={styles.footerName}>ELITE RESOURCE SERVICES</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderLetterheadPdf(input: { title: string; blocks: Block[] }): Promise<Uint8Array> {
  const buffer = await renderToBuffer(<LetterheadDocument {...input} />);
  return new Uint8Array(buffer);
}
