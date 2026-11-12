// Guetteur du presse-papiers pour le relais Wispr Flow -> Victor (compilé par outils/wispr-installer.sh).
// Wispr Flow colle chaque dictée par le presse-papiers (puis le restaure) : on regarde le presse-papiers toutes les 60 ms et,
// seulement quand son texte commence par « Victor », on l'écrit sur la sortie (une ligne JSON) pour wispr-victor.py.
// Tout autre contenu copié est ignoré : il n'est ni gardé, ni écrit, ni envoyé.
import AppKit
import Foundation

let appel = try! NSRegularExpression(pattern: "^\\s*(?:(?:hey|hé|eh|ok|okay|dis|allo|allô)[\\s,]+)?victor\\b", options: [.caseInsensitive])
let pb = NSPasteboard.general
var dernier = pb.changeCount
setvbuf(stdout, nil, _IOLBF, 0)

while true {
    usleep(60_000)
    let n = pb.changeCount
    if n == dernier { continue }
    dernier = n
    guard let t = pb.string(forType: .string), t.count < 1000 else { continue }
    let r = NSRange(t.startIndex..., in: t)
    guard appel.firstMatch(in: t, options: [], range: r) != nil else { continue }
    if let d = try? JSONSerialization.data(withJSONObject: ["texte": t]), let l = String(data: d, encoding: .utf8) { print(l) }
}
