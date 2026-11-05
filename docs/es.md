# Smappee

> **Desarrollada sin el hardware: sus comentarios son bienvenidos.** Esta integración se escribió a
> partir de la biblioteca Smappee de Home Assistant (pysmappee) y la API oficial, y se probó con
> monitores simulados. Si algo no funciona con su Smappee, abra una incidencia:
> https://github.com/guim31/gladys-smappee/issues

## Presentación

Esta integración lleva sus monitores de energía **Smappee** a Gladys: consumo de la casa, producción
solar, importación y exportación de red, submedidores, Smappee Switch y Comfort Plug. Lee primero los
monitores de su red local, y por la nube Smappee aquellos cuya dirección no introduce.

| Monitor                           | Leído por                                   |
| --------------------------------- | ------------------------------------------- |
| Smappee Energy, Solar, Pro/Plus   | API web local (HTTP), cada 5 a 60 segundos  |
| Smappee Infinity, Genius, Connect | broker MQTT local (puerto 1883), en directo |
| Cualquier monitor de su cuenta    | nube Smappee (opcional), cada 5 minutos     |
| Cargadores de su cuenta           | nube Smappee, cada 5 minutos, solo lectura  |

## Requisitos

- Gladys Assistant 5.1 o posterior (5.2 para la pestaña de energía).
- En local: la dirección IP de cada monitor, en la red de Gladys. Fíjele una dirección en su router.
  Energy, Solar y Pro necesitan la contraseña de su interfaz web local (`admin` si no la ha
  cambiado).
- Para la nube (opcional): un identificador y un secreto de cliente de API, que Smappee da a
  petición (pida un «acceso API» al soporte de Smappee), y el usuario y la contraseña de su cuenta
  Smappee.

## Configuración

### Acceso local

En **Integraciones → Smappee → Configuración**, introduzca las direcciones IP de sus monitores,
separadas por comas. Para cada dirección, la integración prueba la API web local y luego el broker
MQTT. La **Contraseña de la interfaz web local** solo la usan Energy, Solar y Pro; déjela vacía para
la contraseña de fábrica.

### Acceso a la nube

Rellene los cuatro campos de la sección **Nube Smappee** para leer los monitores que no están en su
red, y controlar los enchufes conocidos por la nube. Un monitor cuya dirección se introduce solo se lee en local, nunca por la nube: quite su dirección para leerlo por la nube. Con tres campos de cuatro, la nube queda desactivada.

### Opciones

- **Intervalo de actualización local**: frecuencia de envío de las mediciones locales a Gladys (10
  segundos por defecto). Los índices de energía se calculan siempre con cada medición.
- **Controlar los enchufes e interruptores Smappee**: desactivado, se muestran en solo lectura.
- **Idioma de los nombres de dispositivos**: los nombres de las funciones al añadir un dispositivo.

Abra luego la pestaña **Descubrir** y añada los dispositivos que desee.

## Dispositivos

### Monitor

Un dispositivo por monitor, con el nombre de su modelo y su número de serie
(`Smappee Genius 5010000101`):

- **Consumo** (W) e **Índice de consumo** (kWh): toda la casa;
- con paneles solares: **Producción solar** e **Índice de producción solar**, **Importación de
  red** y **Exportación a red** (W), **Índice de importación** e **Índice de exportación** (kWh), deducidos del consumo menos la producción. El **Índice de importación** es entonces el contador facturado, y el **Índice de consumo** el uso de la casa (mostrado, sin coste);
- Infinity, Genius y Connect: **Tensión L1** a **Tensión L3**.

Por su API local, los monitores dan potencias, no contadores: la integración suma potencia × tiempo
en los índices, guardados en su volumen de datos. Un hueco de más de 3 minutos (Gladys o el monitor
detenido) no se rellena. Por la nube, los índices suman los totales de 5 minutos de Smappee. Los
índices empiezan en 0 la primera vez.

### Submedidores

Infinity, Genius y Connect: un dispositivo por circuito configurado en la aplicación Smappee (pinzas
CT), con el nombre de la aplicación, o **Submedidor Smappee** y su número de canal: **Potencia**,
**Índice de energía** y **Corriente**.

### Enchufes e interruptores

Un dispositivo por Smappee Switch, Comfort Plug o módulo de salida de la nube, con una función
**Encendido/Apagado** (con el nombre de la aplicación, si no **Enchufe Smappee** y su número). Un
Comfort Plug (433 MHz) nunca indica su estado: Gladys muestra la última orden enviada.

### Cargadores

Un dispositivo de solo lectura por conector de un cargador Smappee (EV Wall...), con el nombre de la
aplicación, si no **Cargador Smappee** y su número. Solo la nube Smappee los proporciona: rellene la sección de la nube, aunque el monitor se
lea en local. Todos los valores se actualizan cada 5 minutos.

- **Conector**: libre, u ocupado mientras haya un vehículo conectado;
- **Estado de la recarga**: cargando, vehículo conectado, en pausa por el cargador, o en reposo;
- **Potencia de carga** (kW): la media de los últimos 5 minutos, para un monitor leído por la nube,
  y 0 cuando no hay ninguna sesión en curso;
- **Energía de la última sesión** (kWh) y **Duración de la última sesión**: la sesión en curso, si no
  la anterior. Durante una carga, la energía es la medida en el cargador, con unos minutos de retraso;
- **Energía total cargada** (kWh): el contador del cargador, leído en las sesiones. Cambia al terminar
  una sesión, y queda vacía hasta la primera sesión de los últimos 30 días;
- **Índice de energía del cargador** (kWh): la energía medida por el monitor Smappee en el canal del
  cargador (no el contador del cargador), sumada bloque a bloque a partir de los datos de 5 minutos
  de la nube, con unos minutos de retraso. Solo para un cargador cuyo monitor se lee por la nube y
  que tiene un canal de medida. Empieza en 0 al actualizar la integración: sin historial anterior.

Solo el **Índice de energía del cargador** se factura en la pestaña de energía: muestra, día a día y
por media hora, lo que consume el coche. Esa energía ya la cuenta el contador principal: en los
ajustes de energía de Gladys, coloque el índice del cargador **bajo el contador principal** (el
índice del monitor, o un contador Linky/Lixee), si no se cuenta dos veces.

Un cargador añadido antes de la actualización recibe el nuevo índice desde la pestaña
**Descubrimiento** de la integración: haga clic en **Actualizar** en el dispositivo del cargador. Sus
demás funciones, su historial y sus escenas se conservan.

Para iniciar una escena, use el disparador estándar sobre el valor
de un dispositivo, por ejemplo cuando cambie el **Estado de la recarga**.

## Pestaña de energía

La pestaña de energía de Gladys 5.2 calcula el coste de lo que entrega la red: el **Índice de consumo** de un monitor sin paneles solares, el **Índice de importación** de un monitor con paneles solares (su **Índice de consumo**, que incluye la energía solar usada en casa, se muestra pero sin coste). El **Índice de energía** de los submedidores también es un contador de consumo, y el **Índice de producción solar** un contador de producción. Coloque los submedidores, y el **Índice de energía del cargador** de los
cargadores, bajo el contador principal en los ajustes de energía, para no contarlos dos veces. La exportación se muestra, nunca se vuelve a sumar.

## Widget

**Flujo de energía Smappee** muestra un sitio (el primer monitor, o el elegido en su configuración):
**Casa**, y con paneles solares **Solar**, **Importación** y **Exportación**, la red en un indicador
(**Red**, importación a la derecha, exportación a la izquierda) y el **Autoconsumo** de la
producción, con el estado del monitor.

## Disparadores de escena

- **Un Smappee se desconecta**: el monitor deja de responder (3 lecturas locales seguidas, un minuto
  sin mensaje MQTT, o 30 minutos sin datos nuevos de la nube).
- **Un Smappee vuelve a estar en línea**: vuelve a responder.

Ambos pueden limitarse a un monitor, y dan su nombre como variable. Para un **consumo elevado**, use
el disparador estándar de Gladys sobre el valor de un dispositivo: «Consumo» del monitor por encima
de, por ejemplo, 6000 W.

## Acciones

**Buscar monitores Smappee** (pestaña Configuración): se vuelve a conectar a las direcciones y a la
nube, e indica qué respondió, cómo, y qué falla (contraseña, dirección, credenciales de la nube).

## Ejemplos de escenas

- Cuando el **Consumo** del monitor supere 6000 W, apagar el Smappee Switch del calentador de agua y
  enviar un mensaje.
- Cuando la **Exportación a red** supere 1500 W, encender el Comfort Plug de la bomba de la piscina.
- Cuando **Un Smappee se desconecta**, enviar un mensaje (corte de luz, Wi-Fi caído).

## Solución de problemas

- **Ningún dispositivo en Descubrir**: ejecute **Buscar monitores Smappee** y lea su informe.
- «ha rechazado la contraseña»: introduzca la contraseña de la interfaz web local del monitor.
- «ningún Smappee responde en esa dirección»: compruebe la dirección; un Infinity, Genius o Connect
  debe aceptar conexiones en el puerto 1883 desde la red de Gladys.
- «esperando la configuración del Smappee»: el broker MQTT responde pero aún no ha enviado su
  configuración; espere un minuto y vuelva a buscar.
- «credenciales rechazadas»: compruebe el identificador y el secreto dados por Smappee, y su cuenta.
- Registros detallados: inicie la integración con `LOG_LEVEL=debug`.

## Limitaciones

- Cargadores: solo lectura, sin inicio, pausa ni modo de carga desde Gladys. La primera lectura solo
  recupera las sesiones de los últimos 30 días.
- Desarrollada sin el hardware: los formatos de mensajes vienen de pysmappee y de la documentación
  oficial. Sus comentarios son bienvenidos.
- Energy, Solar y Pro no dan ni tensión ni submedidores por su API local.
- Los índices locales los calcula la integración: pueden diferir un poco de la aplicación Smappee.
- La nube da datos de 5 minutos: las potencias son medias de 5 minutos, leídas cada 5 minutos.
- Sin descubrimiento automático: introduzca las direcciones.
- Sin relación con Smappee.
