exports.getSettings = (req, res) => {
  const settings = req.session.settings || {};
  res.json({ ok: true, settings });
};

exports.updateSettings = (req, res) => {
  const { openaiKey, description, allowAttachments, maxAttachmentMb, maxImages, maxPdfTextChars, model } = req.body;

  req.session.settings = {
    openaiKey,
    description,
    allowAttachments,
    maxAttachmentMb,
    maxImages,
    maxPdfTextChars,
    model,
  };

  res.json({ ok: true, settings: req.session.settings });
};
