# Smappee

> **Développée sans le matériel : vos retours sont les bienvenus.** Cette intégration a été écrite
> d'après la bibliothèque Smappee de Home Assistant (pysmappee) et l'API officielle, et testée sur
> des boîtiers simulés. Si quelque chose cloche avec votre Smappee, ouvrez une issue :
> https://github.com/guim31/gladys-smappee/issues

## Présentation

Cette intégration amène vos moniteurs d'énergie **Smappee** dans Gladys : consommation de la maison,
production solaire, soutirage et injection réseau, sous-compteurs, Smappee Switch et Comfort Plug.
Elle lit les boîtiers sur votre réseau local d'abord, et par le cloud Smappee ceux qu'elle ne peut
pas joindre.

| Boîtier                              | Lu par                                       |
| ------------------------------------ | -------------------------------------------- |
| Smappee Energy, Solar, Pro/Plus      | API web locale (HTTP), toutes les 5 à 60 s   |
| Smappee Infinity, Genius, Connect    | broker MQTT local (port 1883), en direct     |
| Tout boîtier de votre compte Smappee | cloud Smappee (facultatif), toutes les 5 min |

## Prérequis

- Gladys Assistant 5.1 ou plus récent (5.2 pour l'onglet énergie).
- En local : l'adresse IP de chaque boîtier, sur le réseau de Gladys. Fixez son adresse dans votre
  box. Energy, Solar et Pro demandent le mot de passe de leur interface web locale (`admin` si vous
  ne l'avez pas changé).
- Pour le cloud (facultatif) : un identifiant et un secret client d'API, que Smappee donne sur
  demande (demandez un « accès API » au support Smappee), et l'utilisateur et le mot de passe de
  votre compte Smappee.

## Configuration

### Accès local

Dans **Intégrations → Smappee → Configuration**, saisissez les adresses IP de vos boîtiers,
séparées par des virgules. Pour chaque adresse, l'intégration essaie l'API web locale, puis le
broker MQTT. Le **Mot de passe de l'interface web locale** ne sert qu'aux Energy, Solar et Pro ;
laissez-le vide pour le mot de passe d'usine.

### Accès cloud

Remplissez les quatre champs de la section **Cloud Smappee** pour lire les boîtiers absents de votre
réseau, et commander les prises connues du cloud. Un boîtier lu en local n'est jamais relu par le
cloud. Avec trois champs sur quatre, le cloud reste coupé.

### Options

- **Rafraîchissement local** : fréquence d'envoi des mesures locales à Gladys (10 secondes par
  défaut). Les index d'énergie sont toujours calculés sur chaque mesure.
- **Commander les prises et interrupteurs Smappee** : désactivé, ils sont affichés en lecture seule.
- **Langue des noms d'appareils** : les noms donnés aux fonctionnalités à l'ajout d'un appareil.

Ouvrez ensuite l'onglet **Découverte** et ajoutez les appareils voulus.

## Appareils

### Boîtier

Un appareil par boîtier, nommé d'après son modèle et son numéro de série
(`Smappee Genius 5010000101`) :

- **Consommation** (W) et **Index de consommation** (kWh) : toute la maison ;
- avec des panneaux solaires : **Production solaire** et **Index de production solaire**,
  **Soutirage réseau** et **Injection réseau** (W), **Index de soutirage** et **Index d'injection**
  (kWh), déduits de la consommation moins la production ;
- Infinity, Genius et Connect : **Tension L1** à **Tension L3**.

Par leur API locale, les boîtiers donnent des puissances, pas des compteurs : l'intégration
additionne puissance × temps dans les index, conservés dans son volume de données. Un trou de plus
de 3 minutes (Gladys ou le boîtier arrêté) n'est pas comblé. Par le cloud, les index additionnent
les totaux sur 5 minutes de Smappee. Les index partent de 0 la première fois.

### Sous-compteurs

Infinity, Genius et Connect : un appareil par circuit configuré dans l'application Smappee (pinces
CT), nommé comme dans l'application, ou **Sous-compteur Smappee** et son numéro de canal :
**Puissance**, **Index d'énergie** et **Courant**.

### Prises et interrupteurs

Un appareil par Smappee Switch, Comfort Plug ou module de sortie du cloud, avec une fonctionnalité
**Marche/Arrêt** (nommé comme dans l'application, sinon **Prise Smappee** et son numéro). Une
Comfort Plug (433 MHz) ne dit jamais son état : Gladys affiche la dernière commande envoyée.

## Onglet énergie

L'**Index de consommation** d'un boîtier et l'**Index d'énergie** de ses sous-compteurs sont des
compteurs de consommation pour l'onglet énergie de Gladys 5.2 ; l'**Index de production solaire** est
un compteur de production. Placez les sous-compteurs sous le boîtier dans les réglages énergie, pour
ne pas les compter deux fois. Le soutirage et l'injection sont affichés, jamais recomptés.

## Widget

**Flux d'énergie Smappee** montre un site (le premier boîtier, ou celui choisi dans ses réglages) :
**Maison**, et avec des panneaux solaires **Solaire**, **Soutirage** et **Injection**, le réseau en
jauge (**Réseau**, soutirage à droite, injection à gauche) et la part d'**Autoconsommation** de la
production, avec l'état du boîtier.

## Déclencheurs de scène

- **Un Smappee passe hors ligne** : le boîtier ne répond plus (3 lectures locales de suite, une
  minute sans message MQTT, ou 30 minutes sans nouvelles données du cloud).
- **Un Smappee est de nouveau en ligne** : il répond de nouveau.

Les deux peuvent se limiter à un boîtier, et donnent son nom en variable. Pour une **forte
consommation**, utilisez le déclencheur standard de Gladys sur la valeur d'un appareil :
« Consommation » du boîtier au-dessus de, par exemple, 6000 W.

## Actions

**Rechercher les boîtiers Smappee** (onglet Configuration) : se reconnecte aux adresses et au cloud,
et dit ce qui a répondu, comment, et ce qui ne va pas (mot de passe, adresse, identifiants du cloud).

## Exemples de scènes

- Quand la **Consommation** du boîtier dépasse 6000 W, couper le Smappee Switch du chauffe-eau et
  envoyer un message.
- Quand l'**Injection réseau** dépasse 1500 W, allumer la Comfort Plug de la pompe de piscine.
- Quand **Un Smappee passe hors ligne**, envoyer un message (coupure de courant, Wi-Fi tombé).

## Dépannage

- **Aucun appareil dans Découverte** : lancez **Rechercher les boîtiers Smappee** et lisez son
  rapport.
- « a refusé le mot de passe » : saisissez le mot de passe de l'interface web locale du boîtier.
- « aucun Smappee ne répond à cette adresse » : vérifiez l'adresse ; un Infinity, Genius ou Connect
  doit accepter les connexions sur le port 1883 depuis le réseau de Gladys.
- « en attente de la configuration du Smappee » : le broker MQTT répond mais n'a pas encore envoyé
  sa configuration ; attendez une minute, puis relancez la recherche.
- « identifiants refusés » : vérifiez l'identifiant et le secret donnés par Smappee, et votre compte.
- Journaux détaillés : lancez l'intégration avec `LOG_LEVEL=debug`.

## Limites

- Développée sans le matériel : les formats de messages viennent de pysmappee et de la documentation
  officielle. Vos retours sont les bienvenus.
- Energy, Solar et Pro ne donnent ni tension ni sous-compteur par leur API locale.
- Les index locaux sont calculés par l'intégration : ils peuvent s'écarter un peu de l'application
  Smappee.
- Le cloud donne des données sur 5 minutes : les puissances sont des moyennes sur 5 minutes, lues
  toutes les 5 minutes.
- Pas de découverte automatique : saisissez les adresses.
- Sans lien avec Smappee.
