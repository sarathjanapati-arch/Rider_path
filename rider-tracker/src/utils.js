function getIndiaDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const lookup = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function asyncHandler(handler) {
  return (req, res) =>
    Promise.resolve(handler(req, res)).catch(error => {
      console.error(error);
      res.status(500).json({ error: error.message || 'Unexpected server error' });
    });
}

module.exports = { getIndiaDateString, asyncHandler };
