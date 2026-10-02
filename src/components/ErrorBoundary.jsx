import React from 'react'

export class ErrorBoundary extends React.Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.error(error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="fatal-error">
          <h1>页面没有正常加载</h1>
          <p>请刷新页面重试。如果问题持续存在，请联系站长 QQ 3281895433。</p>
          <button className="button button--primary" type="button" onClick={() => window.location.reload()}>刷新页面</button>
        </main>
      )
    }
    return this.props.children
  }
}
