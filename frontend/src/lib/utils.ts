import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function assertNever(param: never): never {
  const err = new Error(`Unsupported never param: ${param}`)
  console.log(err.stack)
  throw err
}
