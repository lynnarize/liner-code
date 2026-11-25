/*
  The frame sizes, said one way wherever a size is picked (B39): the Frame tool's menu, the live
  picker's widths and Style's frame sizes name them Desktop, Tablet and Phone, with "1280 × 800" as
  the value at the right end, read from FRAME_SIZES so the words never drift from what is made.
*/
import { createElement, type ReactNode } from "react";
import { FRAME_SIZES, type DesignSize } from "@contracts";
import { I } from "../icons";

export const SIZE_NAME: Record<DesignSize, string> = { desktop: "Desktop", tablet: "Tablet", phone: "Phone" };
export const SIZE_ICON: Record<DesignSize, ReactNode> = { desktop: createElement(I.monitor, { size: 16 }), tablet: createElement(I.tablet, { size: 16 }), phone: createElement(I.device, { size: 16 }) };
/** "1280 × 800". */
export const sizeWords = (size: DesignSize) => `${FRAME_SIZES[size].w} × ${FRAME_SIZES[size].h}`;
