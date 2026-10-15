import { useEffect, useState } from 'react'
import { useTrafficStore } from '@renderer/store/traffic-store'
import { cn } from '@renderer/lib/utils'

const SAMPLES = 32

// Download speed over the last ~30 s, as bars; flat while disconnected
const TrafficSparkline: React.FC<{ active: boolean }> = ({ active }) => {
  const down = useTrafficStore((s) => s.traffic.down)
  const [history, setHistory] = useState<number[]>(() => Array(SAMPLES).fill(0))

  useEffect(() => {
    setHistory((prev) => [...prev.slice(1), active ? down : 0])
  }, [down, active])

  const max = Math.max(...history, 1)
  return (
    <div aria-hidden className="flex h-12 items-end gap-[3px]">
      {history.map((value, i) => (
        <div
          key={i}
          className={cn(
            'flex-1 rounded-[2px] transition-[height] duration-300',
            active ? 'bg-primary/85' : 'bg-secondary'
          )}
          style={{ height: active ? `${Math.max(8, (value / max) * 100)}%` : '8%' }}
        />
      ))}
    </div>
  )
}

export default TrafficSparkline
