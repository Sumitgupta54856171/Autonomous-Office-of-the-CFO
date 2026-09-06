import { useState, useEffect, useRef, useCallback } from 'react'

export interface UseLazyLoadOptions {
  batchSize?: number
  stepSize?: number
  rootMargin?: string
  resetKey?: any
}

export function useLazyLoad<T>(
  items: T[],
  options: UseLazyLoadOptions = {}
) {
  const { batchSize = 15, stepSize = 10, rootMargin = '150px', resetKey } = options
  const [visibleCount, setVisibleCount] = useState<number>(batchSize)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Keep references to latest values to avoid stale closures and unnecessary re-attaching
  const visibleCountRef = useRef(visibleCount)
  visibleCountRef.current = visibleCount

  const itemsLengthRef = useRef(items.length)
  itemsLengthRef.current = items.length

  const isThrottledRef = useRef(false)
  const prevItemsLengthRef = useRef(items.length)

  // Reset pagination when resetKey explicitly changes (e.g. filter or search query change)
  useEffect(() => {
    setVisibleCount(batchSize)
    isThrottledRef.current = false
  }, [resetKey, batchSize])

  // Reset pagination if items length changes (e.g. initial API load or list change)
  useEffect(() => {
    if (prevItemsLengthRef.current !== items.length) {
      prevItemsLengthRef.current = items.length
      setVisibleCount(batchSize)
      isThrottledRef.current = false
    }
  }, [items.length, batchSize])

  const loadMore = useCallback(() => {
    if (isThrottledRef.current) return
    if (visibleCountRef.current >= itemsLengthRef.current) return

    isThrottledRef.current = true
    setIsLoadingMore(true)

    // Increment visible count smoothly
    setVisibleCount((prev) => Math.min(prev + stepSize, itemsLengthRef.current))

    // Cooldown lock to prevent duplicate rapid triggers during layout repaint
    setTimeout(() => {
      setIsLoadingMore(false)
      isThrottledRef.current = false
    }, 250)
  }, [stepSize])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    // If all items are already visible, do not observe
    if (visibleCount >= items.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry && entry.isIntersecting) {
          loadMore()
        }
      },
      { rootMargin }
    )

    observer.observe(sentinel)

    return () => {
      observer.disconnect()
    }
  }, [visibleCount, items.length, rootMargin, loadMore])

  return {
    visibleItems: items.slice(0, visibleCount),
    visibleCount: Math.min(visibleCount, items.length),
    totalCount: items.length,
    hasMore: visibleCount < items.length,
    isLoadingMore,
    sentinelRef,
    loadMore,
  }
}

