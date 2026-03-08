import { useEffect, useRef, useState } from "react";
import SectionRow from "./SectionRow";
import type { PanelData, Product } from "./types";

const TEST_FROM_VIDEO: Product[] = [
  { id: "fv-1", name: "White Plaid Shirt", imageUrl: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400&h=300&fit=crop", price: "$50", url: "https://example.com/white-plaid" },
  { id: "fv-2", name: "Classic Denim Jacket", imageUrl: "https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=400&h=300&fit=crop", price: "$89", url: "https://example.com/denim-jacket" },
  { id: "fv-3", name: "Minimal Sneakers", imageUrl: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=300&fit=crop", price: "$120", url: "https://example.com/sneakers" },
];

const TEST_CURATED: Product[] = [
  { id: "cur-1", name: "Studio Headphones", imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=300&fit=crop", price: "$349", url: "https://example.com/headphones" },
  { id: "cur-2", name: "Leather Tote", imageUrl: "https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=400&h=300&fit=crop", price: "$245", url: "https://example.com/tote" },
  { id: "cur-3", name: "Smart Watch", imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=300&fit=crop", price: "$199", url: "https://example.com/watch" },
];

const defaultData: PanelData = {
  recommended: TEST_FROM_VIDEO,
  all: TEST_CURATED,
};

function getInitialData(): PanelData {
  if (typeof window === "undefined" || !window.__ITRACK_PANEL_DATA__) {
    return defaultData;
  }
  const injected = window.__ITRACK_PANEL_DATA__;
  return {
    recommended: injected.recommended?.length ? injected.recommended : defaultData.recommended,
    all: injected.all?.length ? injected.all : defaultData.all,
  };
}

const DWELL_THRESHOLD_MS = 1500;

export default function App() {
  const [data, setData] = useState<PanelData>(getInitialData);
  const [gazedCardId, setGazedCardId] = useState<string | null>(null);
  const [dwellProgress, setDwellProgress] = useState(0);
  const dwellStartRef = useRef<number>(0);

  // Listen for product data from content script (when running inside extension iframe)
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const d = e.data;
      if (d?.type === "ITRACK_PANEL_DATA" && d.payload) {
        const { recommended = [], all = [] } = d.payload;
        setData({ recommended, all });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Listen for gaze from content script; hit-test cards and manage dwell
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const d = e.data;
      if (d?.type !== "ITRACK_GAZE" || !d.calibrated || typeof d.x !== "number" || typeof d.y !== "number") return;

      const cards = document.querySelectorAll<HTMLElement>(".itrack-card");
      let foundId: string | null = null;
      for (const card of Array.from(cards)) {
        const r = card.getBoundingClientRect();
        if (d.x >= r.left && d.x <= r.right && d.y >= r.top && d.y <= r.bottom) {
          foundId = card.getAttribute("data-product-id");
          break;
        }
      }

      const now = Date.now();
      if (foundId !== gazedCardId) {
        setGazedCardId(foundId);
        setDwellProgress(0);
        if (foundId) dwellStartRef.current = now;
      } else if (foundId) {
        const start = dwellStartRef.current;
        const progress = Math.min((now - start) / DWELL_THRESHOLD_MS, 1);
        setDwellProgress(progress);
        if (progress >= 1) {
          const card = document.querySelector<HTMLElement>(`.itrack-card[data-product-id="${foundId}"]`);
          if (card) {
            card.classList.add("itrack-card--dwell-fired");
            setTimeout(() => card.classList.remove("itrack-card--dwell-fired"), 600);
          }
          window.parent.postMessage(
            {
              type: "ITRACK_DWELL_FIRED",
              payload: {
                productId: card?.getAttribute("data-product-id") ?? "",
                productName: card?.getAttribute("data-product-name") ?? "",
                productUrl: card?.getAttribute("data-product-url") ?? "",
                productPrice: card?.getAttribute("data-product-price") ?? "",
                gazeX: d.x,
                gazeY: d.y,
                dwellDuration: DWELL_THRESHOLD_MS,
              },
            },
            "*"
          );
          setGazedCardId(null);
          setDwellProgress(0);
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [gazedCardId]);

  // Apply gaze/dwell UI to card elements
  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>(".itrack-card");
    cards.forEach((el) => {
      el.classList.remove("itrack-card--gaze-active");
      el.style.removeProperty("--dwell-progress");
    });
    if (gazedCardId) {
      const el = document.querySelector<HTMLElement>(`.itrack-card[data-product-id="${gazedCardId}"]`);
      if (el) {
        el.classList.add("itrack-card--gaze-active");
        el.style.setProperty("--dwell-progress", String(dwellProgress));
      }
    }
  }, [gazedCardId, dwellProgress]);

  return (
    <div className="itrack-panel-app">
      <SectionRow title="From Video" products={data.recommended} />
      <SectionRow title="Curated For You" products={data.all} />
    </div>
  );
}
