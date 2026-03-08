import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { OfferCarousel, type Offer } from "@/components/ui/offer-carousel";
import { GlassFilter } from "@/components/ui/liquid-glass";
import type { PanelData, Product } from "./types";

const defaultData: PanelData = {
  recommended: [],
  all: [],
};

function getInitialData(): PanelData {
  if (typeof window === "undefined" || !window.__ITRACK_PANEL_DATA__) {
    return defaultData;
  }
  const injected = window.__ITRACK_PANEL_DATA__;
  return {
    recommended: Array.isArray(injected.recommended) ? injected.recommended : defaultData.recommended,
    all: Array.isArray(injected.all) ? injected.all : defaultData.all,
  };
}

const DWELL_THRESHOLD_MS = 1500;

function toOffers(products: Product[]): Offer[] {
  return products.map((product) => ({
    id: product.id,
    imageSrc: product.imageUrl,
    imageAlt: product.name,
    title: product.name,
    description: product.shortDescription ?? "",
    price: product.price,
    href: product.url,
    kind: product.kind,
  }));
}

export default function App() {
  const [data, setData] = useState<PanelData>(getInitialData);
  const [gazedCardId, setGazedCardId] = useState<string | null>(null);
  const [dwellProgress, setDwellProgress] = useState(0);
  const dwellStartRef = useRef<number>(0);
  const panelRef = useRef<HTMLDivElement>(null);

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

  useLayoutEffect(() => {
    const sendSize = () => {
      const appEl = panelRef.current;
      if (!appEl) return;
      const measured = Math.ceil(Math.max(appEl.scrollHeight, appEl.getBoundingClientRect().height));
      window.parent.postMessage(
        {
          type: "ITRACK_PANEL_RESIZE",
          height: measured,
        },
        "*",
      );
    };

    sendSize();
    const raf = requestAnimationFrame(sendSize);
    const resizeObserver = new ResizeObserver(() => sendSize());
    if (panelRef.current) resizeObserver.observe(panelRef.current);
    window.addEventListener("resize", sendSize);
    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      window.removeEventListener("resize", sendSize);
    };
  }, [data]);

  return (
    <>
      <GlassFilter />
      <div ref={panelRef} className="itrack-panel-app">
        <OfferCarousel title="From Video" offers={toOffers(data.recommended)} />
        <OfferCarousel title="Curated For You" offers={toOffers(data.all)} />
      </div>
    </>
  );
}
