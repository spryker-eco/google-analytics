<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Communication\Constraint;

use Symfony\Component\Validator\Constraint;

class GoogleAnalyticsCredentialsJsonFormatConstraint extends Constraint
{
    public string $message = 'Service account credentials must be a valid JSON object.';

    public function validatedBy(): string
    {
        return GoogleAnalyticsCredentialsJsonFormatConstraintValidator::class;
    }
}
