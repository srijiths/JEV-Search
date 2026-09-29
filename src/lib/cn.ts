import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Conditional classes with later Tailwind utilities winning over earlier ones. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
