import { useEffect, useRef } from 'react'

// A bounded, local canvas: no network, no timers while hidden, no UI hit targets.
export function SignalField({ enabled = true }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const hero = canvas.parentElement
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return undefined
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    let width = 0, height = 0, frame = 0, previous = 0, elapsed = 0
    let visible = false, reduced = preference.matches
    let nodes = [], waves = [], sparks = [], pointer = null
    const colors = ['131,229,221', '148,185,255', '217,255,67']
    const sprites = colors.map((color) => {
      const sprite = document.createElement('canvas')
      sprite.width = sprite.height = 48
      const brush = sprite.getContext('2d')
      const glow = brush.createRadialGradient(24, 24, 0, 24, 24, 24)
      glow.addColorStop(0, `rgba(${color},.8)`)
      glow.addColorStop(.18, `rgba(${color},.28)`)
      glow.addColorStop(1, `rgba(${color},0)`)
      brush.fillStyle = glow
      brush.fillRect(0, 0, 48, 48)
      return sprite
    })

    function dot(x, y, radius, color, glow = false) {
      if (glow) ctx.drawImage(sprites[color], x - radius * 8, y - radius * 8, radius * 16, radius * 16)
      ctx.fillStyle = `rgba(${colors[color]},.85)`
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill()
    }

    function draw(delta = 0) {
      elapsed += delta
      ctx.clearRect(0, 0, width, height)
      const mobile = width < 760
      const cx = width * (mobile ? .63 : .72), cy = height * (mobile ? .6 : .48)
      const radius = Math.min(width * .44, 540)
      for (let lane = 0; lane < 3; lane += 1) {
        const rx = radius * (1 + lane * .17), ry = radius * (.34 + lane * .11)
        ctx.strokeStyle = `rgba(${colors[lane]},.09)`
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, -.34, 0, Math.PI * 2); ctx.stroke()
        for (let n = 0; n < (mobile ? 7 : 14); n += 1) {
          const angle = n * 2.399 + lane * .9 + elapsed * (.07 + lane * .015)
          const x = Math.cos(angle) * rx, y = Math.sin(angle) * ry
          const px = cx + x * .943 + y * .333, py = cy - x * .333 + y * .943
          dot(px, py, n % 4 === 0 ? 1.7 : .8, lane, n % 4 === 0)
        }
      }

      nodes.forEach((node, index) => {
        node.x = (node.x + node.vx * delta + width) % width
        node.y = (node.y + node.vy * delta + height) % height
        if (pointer && delta) {
          const dx = node.x - pointer.x, dy = node.y - pointer.y
          const distance = Math.hypot(dx, dy)
          if (distance > 0 && distance < 145) {
            const force = (1 - distance / 145) * 38 * delta
            node.x += dx / distance * force; node.y += dy / distance * force
          }
        }
        if (index % 2 === 0) {
          for (let j = index + 1; j < nodes.length; j += 2) {
            const other = nodes[j], distance = Math.hypot(node.x - other.x, node.y - other.y)
            if (distance < 140) {
              ctx.strokeStyle = `rgba(131,229,221,${(1 - distance / 140) * .2})`
              ctx.lineWidth = .7
              ctx.beginPath(); ctx.moveTo(node.x, node.y); ctx.lineTo(other.x, other.y); ctx.stroke()
            }
          }
        }
        dot(node.x, node.y, node.radius, node.color, index % 8 === 0)
      })
      if (pointer) {
        ctx.drawImage(sprites[0], pointer.x - 90, pointer.y - 90, 180, 180)
        nodes.filter((node) => Math.hypot(node.x - pointer.x, node.y - pointer.y) < 165).slice(0, 7).forEach((node) => {
          ctx.strokeStyle = 'rgba(180,246,239,.22)'
          ctx.beginPath(); ctx.moveTo(pointer.x, pointer.y); ctx.lineTo(node.x, node.y); ctx.stroke()
        })
      }
      waves = waves.filter((wave) => wave.age < 1.2)
      for (const wave of waves) {
        wave.age += delta
        ctx.strokeStyle = `rgba(163,237,255,${Math.max(0, 1 - wave.age / 1.2) * .55})`
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(wave.x, wave.y, 12 + wave.age * 180, 0, Math.PI * 2); ctx.stroke()
      }
      sparks = sparks.filter((spark) => spark.age < 1)
      for (const spark of sparks) {
        spark.age += delta; spark.x += spark.vx * delta; spark.y += spark.vy * delta
        ctx.globalAlpha = Math.max(0, 1 - spark.age)
        dot(spark.x, spark.y, 1.4, spark.color, true)
      }
      ctx.globalAlpha = 1
    }

    function resize() {
      const bounds = canvas.getBoundingClientRect()
      if (bounds.width === width && bounds.height === height) return
      width = Math.max(bounds.width, 1); height = Math.max(bounds.height, 1)
      const scale = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale)
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      const count = width < 760 ? 38 : width < 1100 ? 64 : 100
      nodes = Array.from({ length: count }, (_, index) => ({
        x: ((index * .6180339) % 1) * width,
        y: ((index * .4142135 + .13) % 1) * height,
        vx: Math.sin(index * 4.2) * 7, vy: Math.cos(index * 3.7) * 5,
        radius: index % 8 === 0 ? 1.8 : index % 3 === 0 ? 1.2 : .65,
        color: index % 7 === 0 ? 2 : index % 3 === 0 ? 1 : 0
      }))
      draw()
    }
    function loop(time) {
      const interval = width < 760 ? 1000 / 30 : 1000 / 45
      if (!previous) previous = time
      if (time - previous >= interval) { draw(Math.min((time - previous) / 1000, .05)); previous = time }
      frame = requestAnimationFrame(loop)
    }
    function playback() {
      cancelAnimationFrame(frame); frame = 0; previous = 0
      if (enabled && !reduced && visible && !document.hidden) frame = requestAnimationFrame(loop)
      else { pointer = null; waves = []; sparks = []; draw() }
    }
    function coordinates(event) {
      const bounds = canvas.getBoundingClientRect()
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    }
    function move(event) { if (finePointer && enabled && !reduced) pointer = coordinates(event) }
    function leave() { pointer = null }
    function pulse(event) {
      if (!enabled || reduced || event.target.closest('a, button, input, select, textarea, label')) return
      const point = coordinates(event)
      waves.push({ ...point, age: 0 }); waves = waves.slice(-3)
      for (let n = 0; n < 14; n += 1) {
        const angle = n / 14 * Math.PI * 2
        sparks.push({ ...point, age: 0, vx: Math.cos(angle) * 95, vy: Math.sin(angle) * 95, color: n % 3 })
      }
      sparks = sparks.slice(-42)
    }
    function preferenceChanged(event) { reduced = event.matches; playback() }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; playback() })
    const sizeObserver = new ResizeObserver(resize)
    resize(); observer.observe(hero); sizeObserver.observe(hero)
    document.addEventListener('visibilitychange', playback)
    preference.addEventListener('change', preferenceChanged)
    hero.addEventListener('pointermove', move, { passive: true })
    hero.addEventListener('pointerleave', leave)
    hero.addEventListener('pointerdown', pulse, { passive: true })
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); sizeObserver.disconnect()
      document.removeEventListener('visibilitychange', playback)
      preference.removeEventListener('change', preferenceChanged)
      hero.removeEventListener('pointermove', move); hero.removeEventListener('pointerleave', leave); hero.removeEventListener('pointerdown', pulse)
    }
  }, [enabled])

  return <canvas ref={canvasRef} className="signal-field" aria-hidden="true" />
}
