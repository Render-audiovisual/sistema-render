import React from 'react';
import './SectionErrorBoundary.css';

// Contain render/lazy-load failures to the operational section. Never replay a
// request, expose the thrown payload, or automatically reload a dirty document.
export class SectionErrorBoundary extends React.Component {
  state={failed:false};

  static getDerivedStateFromError(){return {failed:true};}

  render(){
    if(!this.state.failed)return this.props.children;
    return <main className="section-error" role="alert"><div className="section-error-content">
      <h1>No pudimos abrir esta sección</h1>
      <p>{typeof this.props.onRetry === 'function' ? 'Podés reintentar o usar el menú para ir a otra sección.' : 'Podés usar el menú para ir a otra sección.'} No se recarga la página ni se descartan borradores automáticamente.</p>
      <p>Un envío ya iniciado puede haberse guardado; revisá su resultado antes de repetirlo.</p>
      {typeof this.props.onRetry === 'function' && <button type="button" onClick={this.props.onRetry}>Reintentar sección</button>}
    </div></main>;
  }
}
