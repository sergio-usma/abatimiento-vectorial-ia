# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Capitanes y prácticos en formación que entrenan la maniobra de remolcadores con doble propulsor azimutal (ASD). Lo usan para entender cómo se comporta el buque bajo viento, corriente y ola, no para navegar de verdad.

## Product Purpose

Simulador de puente ("ASD Bridge Simulator", MVP ECDIS) que hace visible el abatimiento y las fuerzas vectoriales de un remolcador ASD en tiempo real sobre una carta georreferenciada de la bahía de Cartagena. El éxito es que quien entrena entienda por qué el buque se desplaza como lo hace y corrija su maniobra.

## Positioning

Entrenamiento ASD centrado en el análisis vectorial: abatimiento, deriva y fuerzas sobre una carta real de Cartagena, con un copiloto IA como apoyo secundario para analizar la derrota.

## Operating Context

Pantalla grande o de puente. El usuario configura buque, motores y ambiente (viento, corriente, ola, marea), fija una posición inicial en DDMMSS, traza una derrota sobre la carta y maniobra en modo manual o con piloto. Lee telemetría, análisis vectorial y gráficas de abatimiento y batimetría.

## Capabilities and Constraints

- Carta ECDIS georreferenciada (`map/z17-single.*`) de la bahía de Cartagena.
- Doble propulsor azimutal con controles propios (`controles/control.png`), modo manual y piloto, alto general y alinear a proa.
- Paneles de buque y ambiente, telemetría, análisis vectorial, abatimiento vs. tiempo, perfil batimétrico y leyenda.
- Copiloto IA con OpenAI: el usuario pega su propia clave en el navegador; no hay backend.
- Escritorio primero; el móvil es secundario.
- Interfaz y terminología en español marítimo (derrota, abatimiento, proa, eslora, calado).
- Sin decisión registrada sobre mantener el archivo único `index.html`.

## Brand Commitments

Nombre de trabajo "ASD Bridge Simulator / Doble azimutal". No hay logotipo ni guía de marca confirmados.

## Evidence on Hand

Carta y datos de Cartagena en `map/`, imagen de controles en `controles/`. No hay testimonios, métricas ni casos de uso documentados; no inventarlos.

## Product Principles

1. El vector es el protagonista: abatimiento y fuerzas deben leerse de un vistazo.
2. Precisión marítima antes que ornamento: terminología y unidades correctas.
3. Legible en puente: contraste y tamaños pensados para pantalla grande y condiciones de poca luz.
4. La IA asesora, no decide: es apoyo opcional a la derrota del alumno.

## Accessibility & Inclusion

Sin estándar formal establecido. Meta práctica: contraste WCAG AA y texto funcional legible en pantalla de puente.
